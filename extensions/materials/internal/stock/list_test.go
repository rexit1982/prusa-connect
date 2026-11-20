package stock

import (
	"context"
	"errors"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/prusa3d/materials/internal/dbtest"
	"github.com/prusa3d/materials/internal/opt"
)

// listCatalogue has two brands, four materials and one package of m-1.
func listCatalogue() opt.Snapshot {
	empty := 250.0
	net := 1000.0

	return opt.Snapshot{
		Meta: opt.Meta{DataHash: "list"},
		Brands: []opt.Brand{
			{UUID: "b-p", Slug: "prusament", Name: "Prusament"},
			{UUID: "b-o", Slug: "other", Name: "Other"},
		},
		Containers: []opt.Container{{UUID: "c-1", Slug: "spool-1", Name: "Cardboard spool", EmptyWeightG: &empty}},
		Materials: []opt.Material{
			{
				UUID:      "m-1",
				Slug:      "alpha",
				BrandSlug: "prusament",
				Name:      "Alpha",
				Class:     "FFF",
				Type:      "PLA",
				ColorRGBA: "#ff0000ff",
				Tags:      []string{"abrasive", "contains_carbon_fiber"},
			},
			{
				UUID:         "m-2",
				Slug:         "beta",
				BrandSlug:    "other",
				Name:         "Beta",
				Class:        "FFF",
				Type:         "PETG",
				Abbreviation: "PET-G",
				ColorRGBA:    "#00ff00ff",
			},
			{
				UUID:      "m-3",
				Slug:      "gamma",
				BrandSlug: "prusament",
				Name:      "Gamma",
				Class:     "SLA",
				Type:      "Resin",
				ColorRGBA: "#0000ffff",
			},
			{
				UUID:      "m-4",
				Slug:      "delta",
				BrandSlug: "other",
				Name:      "Delta",
				Class:     "FFF",
				Type:      "PLA",
				ColorRGBA: "#ff0011ff",
			},
		},
		Packages: []opt.Package{
			{UUID: "p-1", Slug: "alpha-1kg", MaterialSlug: "alpha", ContainerSlug: "spool-1", NetWeightG: &net},
		},
	}
}

func listStore(t *testing.T, engine dbtest.Engine) *Store {
	t.Helper()

	s := New(dbtest.Open(t, engine.Grant(t)), engine.Name)
	if _, _, err := s.ReplaceCatalogue(context.Background(), listCatalogue(), t0); err != nil {
		t.Fatal(err)
	}

	return s
}

// starAt stars a material for principal at a chosen time.
func starAt(t *testing.T, s *Store, principal, uuid string, at time.Time) {
	t.Helper()

	if err := s.Star(context.Background(), principal, uuid, true); err != nil {
		t.Fatal(err)
	}

	if _, err := s.db.Exec(
		`UPDATE favourites SET starred_at=$3 WHERE principal=$1 AND material_uuid=$2`,
		principal,
		uuid,
		s.at(at),
	); err != nil {
		t.Fatal(err)
	}
}

// customAt creates a custom material for owner created at a chosen time.
func customAt(t *testing.T, s *Store, owner string, f MaterialFields, at time.Time) Custom {
	t.Helper()

	c, err := s.CreateCustom(context.Background(), owner, f)
	if err != nil {
		t.Fatal(err)
	}

	if _, err = s.db.Exec(`UPDATE custom_materials SET created_at=$2 WHERE uuid=$1`, c.UUID, s.at(at)); err != nil {
		t.Fatal(err)
	}

	return c
}

func addSpools(t *testing.T, s *Store, principal, uuid string, n int, grams float64) []Spool {
	t.Helper()

	got, err := s.AddSpools(
		context.Background(),
		principal,
		SpoolDraft{MaterialUUID: uuid, RemainingWeightG: grams, Condition: "new"},
		n,
		1000,
	)
	if err != nil {
		t.Fatal(err)
	}

	return got
}

func list(t *testing.T, s *Store, principal string, q ListQuery) Page {
	t.Helper()

	p, err := s.List(context.Background(), principal, q)
	if err != nil {
		t.Fatal(err)
	}

	return p
}

func uuids(rows []Row) []string {
	out := make([]string, len(rows))
	for i, r := range rows {
		out[i] = r.UUID
	}

	return out
}

func sameUUIDs(t *testing.T, rows []Row, want ...string) {
	t.Helper()

	if got := uuids(rows); fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTheListPutsFavouritesThenOwnCustomsThenTheCatalogue(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)

			// A whole second and half a second later: text times must still sort.
			starAt(t, s, "alice", "m-4", t0)
			starAt(t, s, "alice", "m-3", t0.Add(500*time.Millisecond))
			old := customAt(t, s, "alice", MaterialFields{Name: "Old", Class: "FFF"}, t0)
			young := customAt(t, s, "alice", MaterialFields{Name: "Young", Class: "FFF"}, t0.Add(500*time.Millisecond))
			starred := customAt(t, s, "alice", MaterialFields{Name: "Starred", Class: "FFF"}, t0)
			starAt(t, s, "alice", starred.UUID, t0.Add(time.Second))
			customAt(t, s, "bob", MaterialFields{Name: "Bobs", Class: "FFF"}, t0)
			starAt(t, s, "bob", "m-1", t0)

			p := list(t, s, "alice", ListQuery{})
			sameUUIDs(t, p.Rows, starred.UUID, "m-3", "m-4", young.UUID, old.UUID, "m-1", "m-2")

			if p.Total != 7 || p.Next != nil {
				t.Fatalf("total %d next %v", p.Total, p.Next)
			}

			if r := p.Rows[0]; !r.IsFavourite || !r.IsCustom || r.Name != "Starred" {
				t.Fatalf("%+v", r)
			}

			if r := p.Rows[1]; !r.IsFavourite || r.IsCustom || r.Name != "Gamma" || r.BrandName != "Prusament" ||
				r.Class != "SLA" ||
				r.Type != "Resin" ||
				r.ColorRGBA != "#0000ffff" {
				t.Fatalf("%+v", r)
			}

			if r := p.Rows[5]; r.IsFavourite || r.IsCustom {
				t.Fatalf("bob's star leaks: %+v", r)
			}

			// Another order drops the segments and keeps the flags.
			p = list(t, s, "alice", ListQuery{Order: "name", Desc: true})
			sameUUIDs(t, p.Rows, young.UUID, starred.UUID, old.UUID, "m-3", "m-4", "m-2", "m-1")

			if !p.Rows[1].IsFavourite || !p.Rows[1].IsCustom || !p.Rows[3].IsFavourite {
				t.Fatalf("%+v", p.Rows)
			}

			if _, err := s.List(
				context.Background(),
				"alice",
				ListQuery{Order: "colour"},
			); !errors.Is(
				err,
				ErrInvalid,
			) {
				t.Fatalf("unknown order: %v", err)
			}
		})
	}
}

func TestTheListPutsMaterialsInStockBeforeTheRestOfTheCatalogue(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)

			// By name m-2 sorts before m-4, so only the grams can put m-4 first.
			addSpools(t, s, "alice", "m-4", 1, 900)
			addSpools(t, s, "alice", "m-2", 2, 100)

			sameUUIDs(t, list(t, s, "alice", ListQuery{}).Rows, "m-4", "m-2", "m-1", "m-3")
		})
	}
}

func TestTheListPutsAStockedCustomWithTheStockAndAnEmptyOneAfterIt(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			empty := customAt(t, s, "alice", MaterialFields{Name: "Empty", Class: "FFF"}, t0.Add(time.Second))
			stocked := customAt(t, s, "alice", MaterialFields{Name: "Stocked", Class: "FFF"}, t0)
			addSpools(t, s, "alice", stocked.UUID, 1, 300)
			addSpools(t, s, "alice", "m-4", 1, 900)

			sameUUIDs(t, list(t, s, "alice", ListQuery{}).Rows, "m-4", stocked.UUID, empty.UUID, "m-1", "m-2", "m-3")
		})
	}
}

func TestTheListCountsOnlyFilamentNoPrinterHoldsAsStock(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			addSpools(t, s, "alice", "m-4", 1, 900)
			addSpools(t, s, "alice", "m-3", 1, 0)

			loaded := addSpools(t, s, "alice", "m-2", 1, 500)
			if _, err := s.Assign(
				context.Background(),
				"alice",
				Assignment{DeviceID: "d1", ToolID: "0", SpoolID: &loaded[0].ID, By: ByPerson},
			); err != nil {
				t.Fatal(err)
			}

			sameUUIDs(t, list(t, s, "alice", ListQuery{}).Rows, "m-4", "m-1", "m-2", "m-3")
		})
	}
}

func TestTheListRanksStockByTheFilamentNoPrinterHolds(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			addSpools(t, s, "alice", "m-4", 1, 900)
			addSpools(t, s, "alice", "m-2", 1, 100)

			// m-2 holds more in all, but most of it is on a printer.
			loaded := addSpools(t, s, "alice", "m-2", 1, 1000)
			if _, err := s.Assign(
				context.Background(),
				"alice",
				Assignment{DeviceID: "d1", ToolID: "0", SpoolID: &loaded[0].ID, By: ByPerson},
			); err != nil {
				t.Fatal(err)
			}

			p := list(t, s, "alice", ListQuery{})
			sameUUIDs(t, p.Rows, "m-4", "m-2", "m-1", "m-3")

			if r := p.Rows[1]; r.FreeG != 100 || r.RemainingG != 1100 || r.Spools != 2 {
				t.Fatalf("%+v", r)
			}
		})
	}
}

func TestTheListSumsTheFilamentOfFullSpoolsOnlyWhenEverySpoolHasAFullWeight(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			ctx := context.Background()

			full := SpoolDraft{
				MaterialUUID: "m-1", RemainingWeightG: 400, FullWeightG: new(1250.0), EmptyWeightG: new(250.0),
				Condition: "new",
			}
			if _, err := s.AddSpools(ctx, "alice", full, 2, 1000); err != nil {
				t.Fatal(err)
			}

			p := list(t, s, "alice", ListQuery{InStock: true})
			if r := p.Rows[0]; r.RemainingG != 800 || r.CapacityG == nil || *r.CapacityG != 2000 {
				t.Fatalf("two spools of 1000 g of filament: %+v", r)
			}

			addSpools(t, s, "alice", "m-1", 1, 300)

			p = list(t, s, "alice", ListQuery{InStock: true})
			if r := p.Rows[0]; r.RemainingG != 1100 || r.CapacityG != nil {
				t.Fatalf("a spool with no full weight: %+v", r)
			}
		})
	}
}

func TestTheListShowsAFavouriteWithoutSpools(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			starAt(t, s, "alice", "m-2", t0)
			addSpools(t, s, "alice", "m-1", 2, 300)

			p := list(t, s, "alice", ListQuery{})
			if r := p.Rows[0]; r.UUID != "m-2" || !r.IsFavourite || r.Spools != 0 || r.RemainingG != 0 {
				t.Fatalf("%+v", r)
			}

			if r := p.Rows[1]; r.UUID != "m-1" || r.Spools != 2 || r.RemainingG != 600 {
				t.Fatalf("%+v", r)
			}
		})
	}
}

func TestTheListNeverShowsAnotherPersonsCustomUnlessItHasSpools(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			hidden := customAt(t, s, "bob", MaterialFields{Name: "Hidden", Class: "FFF"}, t0)
			held := customAt(
				t,
				s,
				"bob",
				MaterialFields{Name: "Held", BrandName: "Bobco", Class: "FFF", Type: "ASA", ColorRGBA: "#123456ff"},
				t0,
			)
			addSpools(t, s, "bob", held.UUID, 1, 400)

			p := list(t, s, "alice", ListQuery{})
			sameUUIDs(t, p.Rows, held.UUID, "m-1", "m-2", "m-4", "m-3")

			r := p.Rows[0]
			if r.IsCustom || r.IsFavourite || r.Name != "Held" || r.BrandName != "Bobco" || r.Type != "ASA" ||
				r.ColorRGBA != "#123456ff" || r.Class != "FFF" || r.Spools != 1 || r.RemainingG != 400 {
				t.Fatalf("%+v", r)
			}

			p = list(t, s, "bob", ListQuery{Custom: true})
			sameUUIDs(t, p.Rows, held.UUID, hidden.UUID) // the same time: by name
		})
	}
}

func TestTheListKeepsASpoolWhoseMaterialLeftTheCatalogue(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			addSpools(t, s, "alice", "m-1", 1, 700)

			next := listCatalogue()
			next.Meta.DataHash = "next"
			next.Materials = next.Materials[1:]
			next.Packages = nil

			if _, _, err := s.ReplaceCatalogue(context.Background(), next, t0); err != nil {
				t.Fatal(err)
			}

			p := list(t, s, "alice", ListQuery{})
			sameUUIDs(t, p.Rows, "m-1", "m-2", "m-4", "m-3")

			if r := p.Rows[0]; r.Name != "Alpha" || r.BrandName != "Prusament" || r.Spools != 1 || r.RemainingG != 700 {
				t.Fatalf("%+v", r)
			}
		})
	}
}

func TestTheListFilters(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			starAt(t, s, "alice", "m-2", t0)
			mine := customAt(
				t,
				s,
				"alice",
				MaterialFields{Name: "Mine", BrandName: "prusament", Class: "FFF", Type: "PLA", ColorRGBA: "#ff00aaff"},
				t0,
			)
			theirs := customAt(
				t,
				s,
				"bob",
				MaterialFields{Name: "Theirs 100%", BrandName: "Other", Class: "SLA", Type: "Resin"},
				t0,
			)
			addSpools(t, s, "alice", "m-4", 1, 10)
			addSpools(t, s, "bob", theirs.UUID, 1, 10)

			for name, c := range map[string]struct {
				q    ListQuery
				want []string
			}{
				"favourite": {ListQuery{Favourite: true}, []string{"m-2"}},
				"custom":    {ListQuery{Custom: true}, []string{mine.UUID}},
				"in stock":  {ListQuery{InStock: true}, []string{"m-4", theirs.UUID}},
				"q":         {ListQuery{Q: "pla"}, []string{"m-4", mine.UUID, "m-1"}},
				"q brand":   {ListQuery{Q: "PRUSA"}, []string{mine.UUID, "m-1", "m-3"}},
				"q abbrev":  {ListQuery{Q: "pet-g"}, []string{"m-2"}},
				"q escaped": {ListQuery{Q: "%"}, []string{theirs.UUID}},
				"q under":   {ListQuery{Q: "_"}, nil},
				"brand":     {ListQuery{Brand: "other"}, []string{"m-2", "m-4", theirs.UUID}},
				"type":      {ListQuery{Type: "PLA"}, []string{"m-4", mine.UUID, "m-1"}},
				"class":     {ListQuery{Class: "SLA"}, []string{theirs.UUID, "m-3"}},
				"color":     {ListQuery{Color: "red"}, []string{"m-4", "m-1"}},
				"combined":  {ListQuery{Type: "PLA", Brand: "prusament", InStock: false}, []string{mine.UUID, "m-1"}},
				"switches":  {ListQuery{Favourite: true, InStock: true}, nil},
				"own type":  {ListQuery{Custom: true, Type: "PLA"}, []string{mine.UUID}},
			} {
				t.Run(name, func(t *testing.T) {
					p := list(t, s, "alice", c.q)
					sameUUIDs(t, p.Rows, c.want...)

					if p.Total != len(c.want) {
						t.Fatalf("total %d", p.Total)
					}
				})
			}
		})
	}
}

// TestTheListFindsALetterOutsideASCIIInItsOwnCase: SQLite's lower() leaves
// "Š" as it is, so the search must too.
func TestTheListFindsALetterOutsideASCIIInItsOwnCase(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			grey := customAt(t, s, "alice", MaterialFields{Name: "Šedá PLA", Class: "FFF", Type: "PLA"}, t0)

			for _, q := range []string{"Šedá", "Šedá pla"} {
				sameUUIDs(t, list(t, s, "alice", ListQuery{Q: q}).Rows, grey.UUID)
			}
		})
	}
}

func TestTheListPagesAndTotals(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := New(dbtest.Open(t, engine.Grant(t)), engine.Name)
			snap := opt.Snapshot{Meta: opt.Meta{DataHash: "60"}}

			for i := range 60 {
				snap.Materials = append(
					snap.Materials,
					opt.Material{
						UUID: fmt.Sprintf("m-%02d", i),
						Slug: fmt.Sprintf("s-%02d", i),
						Name: fmt.Sprintf("M %02d", i),
					},
				)
			}

			if _, _, err := s.ReplaceCatalogue(context.Background(), snap, t0); err != nil {
				t.Fatal(err)
			}

			addSpools(t, s, "a", "m-00", 2, 100)
			gone := addSpools(t, s, "a", "m-01", 1, 5000)

			if err := s.DeleteSpool(context.Background(), gone[0].ID, t0); err != nil {
				t.Fatal(err)
			}

			var sizes []int
			for offset := 0; ; {
				p := list(t, s, "a", ListQuery{Offset: offset, Limit: 25})
				sizes = append(sizes, len(p.Rows))

				if p.Total != 60 || p.StockG != 200 || p.StockSpools != 2 {
					t.Fatalf("%+v", p)
				}

				if p.Next == nil {
					break
				}

				offset = *p.Next
			}

			if fmt.Sprint(sizes) != "[25 25 10]" {
				t.Fatalf("pages %v", sizes)
			}

			if p := list(t, s, "a", ListQuery{Offset: 100}); len(p.Rows) != 0 || p.Total != 60 || p.Next != nil {
				t.Fatalf("past the end: %+v", p)
			}

			if p := list(t, s, "a", ListQuery{}); len(p.Rows) != 25 {
				t.Fatalf("default limit: %d", len(p.Rows))
			}

			if p := list(t, s, "a", ListQuery{Limit: 1000}); len(p.Rows) != 60 {
				t.Fatalf("limit: %d", len(p.Rows))
			}

			if p := list(
				t,
				s,
				"a",
				ListQuery{Order: "spools", Desc: true, Limit: 2},
			); p.Rows[0].UUID != "m-00" ||
				p.Rows[1].UUID != "m-01" {
				t.Fatalf("spools order: %v", uuids(p.Rows))
			}
		})
	}
}

func TestTheListCapsItsPageAt100(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := New(dbtest.Open(t, engine.Grant(t)), engine.Name)
			snap := opt.Snapshot{Meta: opt.Meta{DataHash: "150"}}

			for i := range 150 {
				snap.Materials = append(
					snap.Materials,
					opt.Material{UUID: fmt.Sprintf("m-%03d", i), Slug: fmt.Sprintf("s-%03d", i), Name: "M"},
				)
			}

			if _, _, err := s.ReplaceCatalogue(context.Background(), snap, t0); err != nil {
				t.Fatal(err)
			}

			if p := list(t, s, "a", ListQuery{Limit: 1000}); len(p.Rows) != 100 || p.Next == nil || *p.Next != 100 {
				t.Fatalf("%d rows, next %v", len(p.Rows), p.Next)
			}
		})
	}
}

func TestBrandsAreListedByName(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			got, err := listStore(t, engine).Brands(context.Background())
			if err != nil || fmt.Sprint(got) != "[{b-o other Other} {b-p prusament Prusament}]" {
				t.Fatalf("%v %v", got, err)
			}
		})
	}
}

func TestTypesAreTheCatalogueAndTheCallersCustomOnes(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			customAt(t, s, "alice", MaterialFields{Name: "Mine", Class: "FFF", Type: "ASA"}, t0)
			customAt(t, s, "bob", MaterialFields{Name: "Theirs", Class: "FFF", Type: "PC"}, t0)

			got, err := s.Types(context.Background(), "alice")
			if err != nil || fmt.Sprint(got) != "[ASA PETG PLA Resin]" {
				t.Fatalf("%v %v", got, err)
			}
		})
	}
}

func TestMaterialAnswersPackagesWithTheirContainerWeight(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s, ctx := listStore(t, engine), context.Background()
			starAt(t, s, "alice", "m-1", t0)
			addSpools(t, s, "alice", "m-1", 1, 900)

			d, err := s.Material(ctx, "alice", "m-1")
			if err != nil {
				t.Fatal(err)
			}

			if d.Material == nil || d.Material.Slug != "alpha" || d.Material.Type != "PLA" || d.Custom != nil ||
				fmt.Sprint(d.Material.Tags) != "[abrasive contains_carbon_fiber]" {
				t.Fatalf("%+v", d)
			}

			if !d.IsFavourite || d.Spools != 1 || d.RemainingG != 900 || d.BrandName != "Prusament" {
				t.Fatalf("%+v", d.Row)
			}

			if len(d.Packages) != 1 {
				t.Fatalf("%+v", d.Packages)
			}

			if p := d.Packages[0]; p.UUID != "p-1" || p.ContainerName != "Cardboard spool" || p.EmptyWeightG == nil ||
				*p.EmptyWeightG != 250 || p.NetWeightG == nil || *p.NetWeightG != 1000 {
				t.Fatalf("%+v", p)
			}

			if got, gotErr := s.Material(ctx, "alice", "m-2"); gotErr != nil || len(got.Packages) != 0 ||
				got.Packages == nil {
				t.Fatalf("no packages: %+v %v", got, gotErr)
			}

			mine := customAt(t, s, "alice", MaterialFields{Name: "Mine", Class: "FFF"}, t0)
			if own, ownErr := s.Material(ctx, "alice", mine.UUID); ownErr != nil || own.Custom == nil ||
				own.Custom.Name != "Mine" || own.Material != nil || !own.IsCustom {
				t.Fatalf("custom: %+v %v", own, ownErr)
			}

			if _, err = s.Material(ctx, "bob", mine.UUID); !errors.Is(err, ErrNotFound) {
				t.Fatalf("another's custom: %v", err)
			}
		})
	}
}

func TestMaterialAnswersFromCopiesWhenTheCatalogueHasNone(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s, ctx := listStore(t, engine), context.Background()
			held := customAt(t, s, "bob", MaterialFields{Name: "Held", BrandName: "Bobco", Class: "FFF"}, t0)
			addSpools(t, s, "bob", held.UUID, 2, 50)

			d, err := s.Material(ctx, "alice", held.UUID)
			if err != nil {
				t.Fatal(err)
			}

			if d.Material != nil || d.Custom != nil || d.IsCustom || d.Name != "Held" || d.BrandName != "Bobco" ||
				d.Spools != 2 ||
				d.RemainingG != 100 {
				t.Fatalf("%+v", d)
			}

			if _, err = s.Material(ctx, "alice", "nope"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("unknown: %v", err)
			}
		})
	}
}

// Opt-in: go test ./internal/stock/ -run RealZip -v -args -zip=/path/opt.zip
func TestListRealZip(t *testing.T) {
	if *zipPath == "" {
		t.Skip("no -zip flag")
	}

	f, err := os.Open(*zipPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	st, _ := f.Stat()
	snap, err := opt.Read(f, st.Size(), opt.DefaultLimits)
	if err != nil {
		t.Fatal(err)
	}

	db, grant := dbtest.SQLite(t)
	s, ctx := New(db, grant.Engine), context.Background()

	if _, _, err = s.ReplaceCatalogue(ctx, snap, time.Now()); err != nil {
		t.Fatal(err)
	}

	for name, q := range map[string]ListQuery{
		"page 1": {}, "offset 15000": {Offset: 15000}, "q=pla": {Q: "pla"}, "by weight": {Order: "weight", Desc: true},
	} {
		start := time.Now()

		p, listErr := s.List(ctx, "alice", q)
		if listErr != nil {
			t.Fatal(listErr)
		}

		t.Logf("%s: %s, %d rows of %d", name, time.Since(start), len(p.Rows), p.Total)
	}

	rows, err := db.Query(`SELECT color_family, COUNT(*) FROM materials GROUP BY color_family ORDER BY 2 DESC`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var family string
		var n int

		if err = rows.Scan(&family, &n); err != nil {
			t.Fatal(err)
		}

		t.Logf("family %q: %d", family, n)
	}

	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
}

func TestTheListFiltersByColourFamily(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s, ctx := listStore(t, engine), context.Background()

			snap := listCatalogue()
			snap.Meta.DataHash = "families"
			snap.Materials = append(
				snap.Materials,
				opt.Material{
					UUID:      "m-5",
					Slug:      "eps",
					BrandSlug: "other",
					Name:      "Epsilon",
					Class:     "FFF",
					Type:      "PLA",
					ColorRGBA: "#ff8000ff",
				},
				opt.Material{
					UUID:      "m-6",
					Slug:      "zeta",
					BrandSlug: "other",
					Name:      "Zeta",
					Class:     "FFF",
					Type:      "PLA",
					ColorRGBA: "#f58a1eff",
				},
				opt.Material{
					UUID:      "m-7",
					Slug:      "eta",
					BrandSlug: "other",
					Name:      "Eta",
					Class:     "FFF",
					Type:      "PLA",
					ColorRGBA: "#ff7f00ff",
				},
			)
			if _, _, err := s.ReplaceCatalogue(ctx, snap, t0); err != nil {
				t.Fatal(err)
			}

			custom := customAt(t, s, "alice", MaterialFields{Name: "Mine", Class: "FFF", ColorRGBA: "#ff9000ff"}, t0)
			addSpools(t, s, "alice", "m-7", 1, 100)

			if _, err := s.db.Exec(`DELETE FROM materials WHERE uuid = 'm-7'`); err != nil {
				t.Fatal(err)
			}

			names := func(color string) []string {
				p, err := s.List(ctx, "alice", ListQuery{Color: color, Order: "name"})
				if err != nil {
					t.Fatal(err)
				}

				out := []string{}
				for _, r := range p.Rows {
					out = append(out, r.Name)
				}

				return out
			}

			if got := names("orange"); fmt.Sprint(got) != "[Epsilon Eta Mine Zeta]" {
				t.Fatalf("orange: %v (custom %s)", got, custom.UUID)
			}

			if got := names("blue"); fmt.Sprint(got) != "[Gamma]" {
				t.Fatalf("blue: %v", got)
			}

			if _, err := s.List(ctx, "alice", ListQuery{Color: "#ff"}); !errors.Is(err, ErrInvalid) {
				t.Fatalf("unknown family: %v", err)
			}
		})
	}
}

func TestTheListKeepsOneLocation(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			ctx := context.Background()

			shelf, err := s.CreateLocation(ctx, "Shelf A")
			if err != nil {
				t.Fatal(err)
			}

			other, err := s.CreateLocation(ctx, "Shelf B")
			if err != nil {
				t.Fatal(err)
			}

			for _, d := range []SpoolDraft{
				{MaterialUUID: "m-4", RemainingWeightG: 300, Condition: "new", LocationID: &shelf.ID},
				{MaterialUUID: "m-4", RemainingWeightG: 500, Condition: "new", LocationID: &other.ID},
				{MaterialUUID: "m-1", RemainingWeightG: 900, Condition: "new"},
			} {
				if _, err = s.AddSpools(ctx, "alice", d, 1, 1000); err != nil {
					t.Fatal(err)
				}
			}

			p := list(t, s, "alice", ListQuery{Location: shelf.ID})
			sameUUIDs(t, p.Rows, "m-4")

			if r := p.Rows[0]; p.Total != 1 || r.Spools != 1 || r.RemainingG != 300 {
				t.Fatalf("total %d, %+v", p.Total, r)
			}

			sameUUIDs(t, list(t, s, "alice", ListQuery{Location: other.ID, Type: "ABS"}).Rows)
		})
	}
}

func TestTheListKeepsAndCountsWhatIsOnAPrinter(t *testing.T) {
	for _, engine := range dbtest.Engines(t) {
		t.Run(string(engine.Name), func(t *testing.T) {
			s := listStore(t, engine)
			ctx := context.Background()
			spools := addSpools(t, s, "alice", "m-1", 3, 300)

			for _, a := range []Assignment{
				{DeviceID: "d1", ToolID: "0", SpoolID: &spools[0].ID, By: ByPerson},
				{DeviceID: "d1", ToolID: "1", MaterialUUID: "m-2", By: ByPerson},
			} {
				if _, err := s.Assign(ctx, "alice", a); err != nil {
					t.Fatal(err)
				}
			}

			p := list(t, s, "alice", ListQuery{Assigned: true, Order: "name"})

			got := map[string]int{}
			for _, r := range p.Rows {
				got[r.UUID] = r.AssignedSpools
			}

			if want := map[string]int{"m-1": 1, "m-2": 0}; !reflect.DeepEqual(got, want) {
				t.Errorf("the materials on a printer are %v, want %v", got, want)
			}
		})
	}
}
