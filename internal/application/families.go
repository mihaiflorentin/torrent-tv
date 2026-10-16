package application

import (
	"context"
	"fmt"
	"sort"
	"time"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

const (
	// familyCacheTTL bounds how stale tile counts and art can be; the catalog
	// grows at most hourly.
	familyCacheTTL = 10 * time.Minute
	// familyArtPool is how many of a family's best titles with artwork are
	// candidates for the quarter's image.
	familyArtPool = 10
	// familyArtScan is how many top-rated and most-seeded titles are examined
	// to fill the pool.
	familyArtScan = 30
	// familyBuildTimeout bounds one background computation of the tiles.
	familyBuildTimeout = 2 * time.Minute
)

type familyCache struct {
	at      time.Time
	quarter string
	items   []domain.FamilySummary
}

// familyFlight is one in-progress computation shared by every caller that
// needs the families while it runs.
type familyFlight struct {
	done  chan struct{}
	items []domain.FamilySummary
	err   error
}

func (s *Service) familyClock() time.Time {
	if s.familyNow != nil {
		return s.familyNow()
	}
	return time.Now()
}

// invalidateFamilies drops the cache entirely, so the next caller waits for a
// fresh computation.
func (s *Service) invalidateFamilies() {
	s.familyMu.Lock()
	s.families = familyCache{}
	s.familyGen++
	s.familyMu.Unlock()
}

// RefreshFamilies marks the cached tiles stale after the catalog changed and
// recomputes them in the background. Callers keep getting the previous tiles
// until the new ones are ready.
func (s *Service) RefreshFamilies() {
	s.familyMu.Lock()
	s.families.at = time.Time{}
	s.familyGen++
	s.startFamilyFlightLocked()
	s.familyMu.Unlock()
}

// WarmFamilies computes the tiles in the background unless they are already
// cached and fresh, so the first Categories page does not wait for them.
func (s *Service) WarmFamilies() {
	s.familyMu.Lock()
	defer s.familyMu.Unlock()
	if !s.familiesFreshLocked(s.familyClock()) {
		s.startFamilyFlightLocked()
	}
}

func (s *Service) familiesFreshLocked(now time.Time) bool {
	return s.families.items != nil && s.families.quarter == domain.ArtQuarter(now) &&
		now.Sub(s.families.at) < familyCacheTTL && !now.Before(s.families.at)
}

// CatalogFamilies lists the Category families that have titles in the catalog,
// each with its count, newest title, raw categories and Family art. The tiles
// are cached for a few minutes; a stale cache is served as is while a single
// background computation refreshes it, so only the very first call after a
// cold start waits.
func (s *Service) CatalogFamilies(ctx context.Context) ([]domain.FamilySummary, error) {
	s.familyMu.Lock()
	if s.familiesFreshLocked(s.familyClock()) {
		items := s.families.items
		s.familyMu.Unlock()
		return items, nil
	}
	flight := s.startFamilyFlightLocked()
	if s.families.items != nil {
		items := s.families.items
		s.familyMu.Unlock()
		return items, nil
	}
	s.familyMu.Unlock()
	if flight == nil {
		return nil, fmt.Errorf("catalog families unavailable: service is stopping")
	}
	select {
	case <-flight.done:
		return flight.items, flight.err
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// startFamilyFlightLocked starts the background computation unless one is
// already running (single flight) and returns the running one. It returns nil
// when the service is stopping. Callers hold familyMu.
func (s *Service) startFamilyFlightLocked() *familyFlight {
	if s.familyFlight != nil {
		return s.familyFlight
	}
	select {
	case <-s.stopping:
		return nil
	default:
	}
	flight := &familyFlight{done: make(chan struct{})}
	s.familyFlight = flight
	s.wg.Add(1)
	go s.runFamilyFlight(flight)
	return flight
}

// runFamilyFlight computes the tiles on a context of its own, detached from
// whichever request triggered it, so a client giving up neither aborts the
// work nor the storing of art picks. It recomputes when the catalog changed
// while it was running, storing such a result as already stale.
func (s *Service) runFamilyFlight(flight *familyFlight) {
	defer s.wg.Done()
	for {
		s.familyMu.Lock()
		gen := s.familyGen
		s.familyMu.Unlock()
		ctx, cancel := context.WithTimeout(s.baseCtx, familyBuildTimeout)
		now := s.familyClock()
		quarter := domain.ArtQuarter(now)
		items, err := s.buildFamilies(ctx, quarter)
		cancel()

		s.familyMu.Lock()
		changed := s.familyGen != gen
		if err == nil {
			at := now
			if changed {
				at = time.Time{}
			}
			s.families = familyCache{at: at, quarter: quarter, items: items}
			if changed {
				s.familyMu.Unlock()
				continue
			}
		}
		s.familyFlight = nil
		flight.items, flight.err = items, err
		s.familyMu.Unlock()
		if err != nil {
			s.log.Warn("family tiles not refreshed", "error", err)
		}
		close(flight.done)
		return
	}
}

// familyAgg folds the (category, title) rows of one family.
type familyAgg struct {
	categories map[string]bool
	titles     map[string]*familyTitle
}

type familyTitle struct {
	id      string
	newest  int64
	seeders int
	rating  float64
	artKind string
}

// buildFamilies computes every tile from one aggregate query over the catalog
// plus one query for the newest titles' names, instead of querying per family.
func (s *Service) buildFamilies(ctx context.Context, quarter string) ([]domain.FamilySummary, error) {
	rows, err := s.repo.CatalogFamilyRows(ctx, s.eligibleTrackerIDs())
	if err != nil {
		return nil, err
	}
	aggs := map[string]*familyAgg{}
	familyOf := map[string]string{}
	for _, row := range rows {
		key, cached := familyOf[row.Category]
		if !cached {
			key, _ = domain.FamilyForCategory(row.Category)
			familyOf[row.Category] = key
		}
		if key == "" {
			continue
		}
		agg := aggs[key]
		if agg == nil {
			agg = &familyAgg{categories: map[string]bool{}, titles: map[string]*familyTitle{}}
			aggs[key] = agg
		}
		agg.categories[row.Category] = true
		title := agg.titles[row.TitleID]
		if title == nil {
			title = &familyTitle{id: row.TitleID}
			agg.titles[row.TitleID] = title
		}
		if row.UploadedAt > title.newest {
			title.newest = row.UploadedAt
		}
		if row.Seeders > title.seeders {
			title.seeders = row.Seeders
		}
		if row.Rating > title.rating {
			title.rating = row.Rating
		}
		if title.artKind == "" || row.ArtKind == "backdrop" {
			title.artKind = row.ArtKind
		}
	}
	items := []domain.FamilySummary{}
	newestIDs := []string{}
	for _, family := range domain.CategoryFamilies {
		agg := aggs[family.Key]
		if agg == nil || len(agg.titles) == 0 {
			continue
		}
		categories := make([]string, 0, len(agg.categories))
		for category := range agg.categories {
			categories = append(categories, category)
		}
		sort.Strings(categories)
		summary := domain.FamilySummary{Key: family.Key, Name: family.Name, Count: len(agg.titles), Categories: categories}
		summary.NewestID = newestFamilyTitle(agg.titles)
		if summary.NewestID != "" {
			newestIDs = append(newestIDs, summary.NewestID)
		}
		summary.Art = s.familyArt(ctx, family.Key, quarter, agg.titles)
		items = append(items, summary)
	}
	names, err := s.familyTitleNames(ctx, newestIDs)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].NewestTitle = names[items[i].NewestID]
	}
	return items, nil
}

// newestFamilyTitle is the title with the latest upload, ties broken by the
// larger ID, matching the catalog's default newest-first order.
func newestFamilyTitle(titles map[string]*familyTitle) string {
	best := ""
	var bestAt int64
	for id, title := range titles {
		if best == "" || title.newest > bestAt || (title.newest == bestAt && id > best) {
			best, bestAt = id, title.newest
		}
	}
	return best
}

// familyTitleNames resolves display names (metadata title when known) for the
// few newest titles.
func (s *Service) familyTitleNames(ctx context.Context, ids []string) (map[string]string, error) {
	names := map[string]string{}
	if len(ids) == 0 {
		return names, nil
	}
	sources, err := s.repo.ListCatalogSourcesByTitleIDs(ctx, ids, s.eligibleTrackerIDs())
	if err != nil {
		return nil, err
	}
	grouped := groupCatalog(sources, false)
	for i := range grouped {
		s.applyMetadataOnly(&grouped[i])
		names[grouped[i].ID] = grouped[i].Title
	}
	return names, nil
}

// familyArt returns the family's image for the quarter. The pick is stored per
// (family, quarter) and reused for the whole quarter while the stored title still
// has artwork and still belongs to the family, so ranking changes from catalog
// syncs never move the image. When there is no usable stored pick (a new quarter,
// or the title lost its art or left the catalog) one is drawn deterministically
// from the family's best titles with artwork and stored.
func (s *Service) familyArt(ctx context.Context, key, quarter string, titles map[string]*familyTitle) domain.FamilyArt {
	bundled := domain.FamilyArt{URL: domain.BundledFamilyArtURL(key), Source: "bundled"}
	art := func(id, kind string) domain.FamilyArt {
		return domain.FamilyArt{URL: fmt.Sprintf("/api/v1/artwork/%s/%s", id, kind), Source: "catalog", TitleID: id}
	}
	if stored, err := s.repo.FamilyArtPick(ctx, key, quarter); err == nil {
		if title := titles[stored]; title != nil && title.artKind != "" {
			return art(stored, title.artKind)
		}
	}
	all := make([]*familyTitle, 0, len(titles))
	for _, title := range titles {
		all = append(all, title)
	}
	candidates := []string{}
	seen := map[string]bool{}
	collect := func(less func(a, b *familyTitle) bool) {
		sort.Slice(all, func(i, j int) bool { return less(all[i], all[j]) })
		for i := 0; i < len(all) && i < familyArtScan; i++ {
			title := all[i]
			if seen[title.id] || len(candidates) >= familyArtPool || title.artKind == "" {
				continue
			}
			seen[title.id] = true
			candidates = append(candidates, title.id)
		}
	}
	// Rated titles first, then by rating; unrated titles rank after them.
	collect(func(a, b *familyTitle) bool {
		if (a.rating > 0) != (b.rating > 0) {
			return a.rating > 0
		}
		if a.rating != b.rating {
			return a.rating > b.rating
		}
		return a.id < b.id
	})
	collect(func(a, b *familyTitle) bool {
		if a.seeders != b.seeders {
			return a.seeders > b.seeders
		}
		return a.id < b.id
	})
	id, ok := domain.PickFamilyArt(key, quarter, candidates)
	if !ok {
		return bundled
	}
	if err := s.repo.SaveFamilyArtPick(ctx, key, quarter, id); err != nil {
		s.log.Warn("family art pick not stored", "family", key, "error", err)
	}
	return art(id, titles[id].artKind)
}

// familyCategories returns the raw tracker categories of a family that exist in
// the catalog. An unknown family key is an error; a known family with no
// categories yields none.
func (s *Service) familyCategories(ctx context.Context, key string) ([]string, error) {
	if _, ok := domain.CategoryFamilyByKey(key); !ok {
		return nil, fmt.Errorf("unknown category family %q", key)
	}
	items, err := s.CatalogFamilies(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		if item.Key == key {
			return item.Categories, nil
		}
	}
	return nil, nil
}
