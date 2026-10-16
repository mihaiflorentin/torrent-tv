package application

import (
	"sort"
	"strings"

	"github.com/mihaiflorentin/torrent-tv/internal/domain"
)

// DedupeLibraryItems collapses the household state into one item per canonical
// title and tracker category (or per source/release when no title is known),
// keeping the most recently updated, newest first.
func DedupeLibraryItems(state domain.HouseholdState) []domain.HouseholdItem {
	bySource := map[string]domain.HouseholdItem{}
	for _, group := range [][]domain.HouseholdItem{state.Favorites, state.ContinueWatching, state.Watched, state.Recent} {
		for _, item := range group {
			titleID := item.TitleID
			if titleID == "" && item.Catalog != nil {
				titleID = item.Catalog.ID
			}
			key := ""
			if titleID != "" {
				key = "title:" + titleID + "|category:" + strings.ToLower(item.Release.Category)
			} else if item.SourceID != "" {
				key = "source:" + item.SourceID
			} else {
				key = "release:" + item.Release.ID
			}
			if current, exists := bySource[key]; !exists || item.UpdatedAt.After(current.UpdatedAt) {
				bySource[key] = item
			}
		}
	}
	items := make([]domain.HouseholdItem, 0, len(bySource))
	for _, item := range bySource {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].UpdatedAt.Equal(items[j].UpdatedAt) {
			return items[i].UpdatedAt.After(items[j].UpdatedAt)
		}
		return items[i].Release.ID < items[j].Release.ID
	})
	return items
}

func libraryTitleKey(item domain.HouseholdItem) string {
	if item.TitleID != "" {
		return "title:" + item.TitleID
	}
	if item.Catalog != nil && item.Catalog.ID != "" {
		return "title:" + item.Catalog.ID
	}
	if item.SourceID != "" {
		return "source:" + item.SourceID
	}
	return "release:" + item.Release.ID
}

func libraryTitleName(item domain.HouseholdItem) string {
	if item.Catalog != nil && item.Catalog.Title != "" {
		return item.Catalog.Title
	}
	return item.Release.Name
}

// LibraryFamilies groups the (deduplicated) library items into Category
// families with the same tile shape as the catalog's. Art comes from a
// deterministic quarterly pick among the family's titles that have artwork,
// ranked by rating then title ID; otherwise the family's bundled art.
func LibraryFamilies(items []domain.HouseholdItem, quarter string) []domain.FamilySummary {
	type group struct {
		titles     map[string]bool
		categories map[string]bool
		newest     domain.HouseholdItem
		art        map[string]domain.CatalogTitle
	}
	groups := map[string]*group{}
	for _, item := range items {
		key, ok := domain.FamilyForCategory(item.Release.Category)
		if !ok {
			continue
		}
		g := groups[key]
		if g == nil {
			g = &group{titles: map[string]bool{}, categories: map[string]bool{}, art: map[string]domain.CatalogTitle{}}
			groups[key] = g
		}
		g.titles[libraryTitleKey(item)] = true
		g.categories[item.Release.Category] = true
		if len(g.titles) == 1 || item.UpdatedAt.After(g.newest.UpdatedAt) {
			g.newest = item
		}
		if item.Catalog != nil && item.Catalog.ID != "" && (item.Catalog.BackdropURL != "" || item.Catalog.PosterURL != "") {
			g.art[item.Catalog.ID] = *item.Catalog
		}
	}
	out := []domain.FamilySummary{}
	for _, family := range domain.CategoryFamilies {
		g := groups[family.Key]
		if g == nil {
			continue
		}
		summary := domain.FamilySummary{
			Key: family.Key, Name: family.Name, Count: len(g.titles), NewestTitle: libraryTitleName(g.newest),
			Categories: sortedKeys(g.categories),
			Art:        domain.FamilyArt{URL: domain.BundledFamilyArtURL(family.Key), Source: "bundled"},
		}
		if g.newest.Catalog != nil {
			summary.NewestID = g.newest.Catalog.ID
		}
		ranked := make([]domain.CatalogTitle, 0, len(g.art))
		for _, title := range g.art {
			ranked = append(ranked, title)
		}
		sort.Slice(ranked, func(i, j int) bool {
			if ranked[i].Rating != ranked[j].Rating {
				return ranked[i].Rating > ranked[j].Rating
			}
			return ranked[i].ID < ranked[j].ID
		})
		if len(ranked) > familyArtPool {
			ranked = ranked[:familyArtPool]
		}
		ids := make([]string, len(ranked))
		for i, title := range ranked {
			ids[i] = title.ID
		}
		if id, ok := domain.PickFamilyArt(family.Key, quarter, ids); ok {
			title := g.art[id]
			url := title.BackdropURL
			if url == "" {
				url = title.PosterURL
			}
			summary.Art = domain.FamilyArt{URL: url, Source: "catalog", TitleID: id}
		}
		out = append(out, summary)
	}
	return out
}

// LibraryFamilyItems returns the library items of one family, newest first,
// optionally narrowed to one raw tracker category inside it.
func LibraryFamilyItems(items []domain.HouseholdItem, familyKey, category string) []domain.HouseholdItem {
	out := []domain.HouseholdItem{}
	for _, item := range items {
		key, ok := domain.FamilyForCategory(item.Release.Category)
		if !ok || key != familyKey {
			continue
		}
		if category != "" && !strings.EqualFold(item.Release.Category, category) {
			continue
		}
		out = append(out, item)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

// CurrentFamilyQuarter is the art quarter family art is chosen for right now.
func (s *Service) CurrentFamilyQuarter() string { return domain.ArtQuarter(s.familyClock()) }
