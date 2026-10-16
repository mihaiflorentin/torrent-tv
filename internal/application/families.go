package application

import (
	"context"
	"fmt"
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
)

type familyCache struct {
	at      time.Time
	quarter string
	items   []domain.FamilySummary
}

func (s *Service) familyClock() time.Time {
	if s.familyNow != nil {
		return s.familyNow()
	}
	return time.Now()
}

func (s *Service) invalidateFamilies() {
	s.familyMu.Lock()
	s.families = familyCache{}
	s.familyMu.Unlock()
}

// CatalogFamilies lists the Category families that have titles in the catalog,
// each with its count, newest title, raw categories and Family art. Results
// are cached for a few minutes and recomputed when the art quarter turns.
func (s *Service) CatalogFamilies(ctx context.Context) ([]domain.FamilySummary, error) {
	s.familyMu.Lock()
	defer s.familyMu.Unlock()
	now := s.familyClock()
	quarter := domain.ArtQuarter(now)
	if s.families.items != nil && s.families.quarter == quarter && now.Sub(s.families.at) < familyCacheTTL && now.After(s.families.at) {
		return s.families.items, nil
	}
	items, err := s.buildFamilies(ctx, quarter)
	if err != nil {
		return nil, err
	}
	s.families = familyCache{at: now, quarter: quarter, items: items}
	return items, nil
}

func (s *Service) buildFamilies(ctx context.Context, quarter string) ([]domain.FamilySummary, error) {
	facets, err := s.CatalogFacets(ctx)
	if err != nil {
		return nil, err
	}
	byFamily := map[string][]string{}
	for _, category := range facets.Categories {
		if key, ok := domain.FamilyForCategory(category); ok {
			byFamily[key] = append(byFamily[key], category)
		}
	}
	items := []domain.FamilySummary{}
	for _, family := range domain.CategoryFamilies {
		categories := byFamily[family.Key]
		if len(categories) == 0 {
			continue
		}
		page, err := s.CatalogTitles(ctx, domain.CatalogQuery{Categories: categories, Limit: 1})
		if err != nil {
			return nil, err
		}
		if page.Total == 0 {
			continue
		}
		summary := domain.FamilySummary{Key: family.Key, Name: family.Name, Count: page.Total, Categories: categories}
		if len(page.Items) > 0 {
			summary.NewestTitle, summary.NewestID = page.Items[0].Title, page.Items[0].ID
		}
		summary.Art = s.familyArt(ctx, family.Key, quarter, categories)
		items = append(items, summary)
	}
	return items, nil
}

// familyArt picks the family's image for the quarter from its best titles that
// have artwork, ranked by rating and then by seeders with ties broken by title
// ID, so the ranked list (and so the pick) is the same on every call.
func (s *Service) familyArt(ctx context.Context, key, quarter string, categories []string) domain.FamilyArt {
	bundled := domain.FamilyArt{URL: domain.BundledFamilyArtURL(key), Source: "bundled"}
	candidates := []string{}
	kinds := map[string]string{}
	for _, order := range []string{"rating", "seeders"} {
		page, err := s.repo.QueryCatalogTitleIDs(ctx, domain.CatalogQuery{Categories: categories, TrackerIDs: s.eligibleTrackerIDs(), Sort: order, Limit: familyArtScan})
		if err != nil {
			continue
		}
		for _, id := range page.Items {
			if _, seen := kinds[id]; seen || len(candidates) >= familyArtPool {
				continue
			}
			metadata, err := s.repo.GetCatalogMetadata(ctx, id)
			if err != nil {
				continue
			}
			switch {
			case metadata.BackdropPath != "":
				kinds[id] = "backdrop"
			case metadata.PosterPath != "":
				kinds[id] = "poster"
			default:
				continue
			}
			candidates = append(candidates, id)
		}
	}
	id, ok := domain.PickFamilyArt(key, quarter, candidates)
	if !ok {
		return bundled
	}
	return domain.FamilyArt{URL: fmt.Sprintf("/api/v1/artwork/%s/%s", id, kinds[id]), Source: "catalog", TitleID: id}
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
