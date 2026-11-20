package stock

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/prusa3d/prusa-connect/sdk/wirerpc"

	"github.com/prusa3d/materials/internal/colour"
	"github.com/prusa3d/materials/internal/opt"
)

// MaxPage is the most rows a list answers.
const MaxPage = 100

// ListQuery is one page of the materials list. Order is "" (the four
// segments), "name", "brand", "type", "spools" or "weight". Brand is a brand slug, Color a colour family.
type ListQuery struct {
	Q, Brand, Type, Class, Color string
	Favourite, Custom, InStock   bool
	// Assigned keeps the materials a printer tool holds, with or without a
	// spool.
	Assigned bool
	// Location keeps the materials with a live spool there and counts only
	// those spools; 0 is any location.
	Location      int64
	Order         string
	Desc          bool
	Offset, Limit int
}

// Row is one material of the list, whatever its origin, with its live spools.
type Row struct {
	UUID        string `json:"uuid"`
	Name        string `json:"name"`
	BrandName   string `json:"brand_name"`
	Class       string `json:"class"`
	Type        string `json:"type"`
	ColorRGBA   string `json:"color_rgba"`
	IsFavourite bool   `json:"is_favourite"`
	IsCustom    bool   `json:"is_custom"`
	Spools      int    `json:"spools"`
	// AssignedSpools is how many of those spools are on a printer tool.
	AssignedSpools int     `json:"assigned_spools"`
	RemainingG     float64 `json:"remaining_g"`
	// FreeG is the part of RemainingG on spools no printer tool holds, the
	// filament a person can still load. The default order ranks by it.
	FreeG float64 `json:"free_g"`
	// CapacityG is the filament the live spools held when full, their full
	// weight less the empty spool, and nil when one of them has no full weight
	// recorded: counting that spool's remaining weight instead would draw it
	// as untouched.
	CapacityG *float64 `json:"capacity_g,omitempty"`
}

// Page is one page of rows, the size of the whole filtered list, and the
// totals over every live spool.
type Page struct {
	Rows        []Row   `json:"rows"`
	Total       int     `json:"total"`
	Next        *int    `json:"next,omitempty"`
	StockG      float64 `json:"stock_g"`
	StockSpools int     `json:"stock_spools"`
}

// Detail is one material: its row, and the catalogue material with its
// packages or the caller's custom material. Both are nil for a material only
// spools still know.
type Detail struct {
	Row

	Material *opt.Material `json:"material,omitempty"`
	Custom   *Custom       `json:"custom,omitempty"`
	Packages []PackageView `json:"packages"`
}

// PackageView is a catalogue package with its container.
type PackageView struct {
	opt.Package

	ContainerName string   `json:"container_name"`
	EmptyWeightG  *float64 `json:"empty_weight_g,omitempty"`
}

// listFrom is the merged list: every catalogue material, the caller's custom materials, and a row built
// from the newest live spool for a material neither knows, such as one an
// import dropped or another person's custom material. seg is 1 for the
// caller's favourites, 2 for any other material with filament on a spool no
// printer holds, so a picker shows what can be loaded without a search, 3 for
// the caller's other custom materials, and 4 for the rest. free_g is that
// filament: a spool on a tool, or one with nothing left, is not stock to pick.
// The In stock filter and the spools and weight orders count every live spool
// instead, because they describe the shelf, not what a picker can load.
// $1 is the caller, $2–$12 the filters.
const listFrom = ` FROM (
	SELECT c.uuid, c.name, c.brand_name, c.brand_slug, c.class, c.type, c.abbreviation, c.color_rgba, c.color_family, c.src, c.created_at,
		f.starred_at, f.material_uuid IS NOT NULL AS fav,
		CASE WHEN f.material_uuid IS NOT NULL THEN 1 WHEN h.free_g > 0 THEN 2
			WHEN c.src = 'custom' THEN 3 ELSE 4 END AS seg,
		COALESCE(h.free_g, 0) AS free_g, COALESCE(h.n, 0) AS spools, COALESCE(h.on_tools, 0) AS on_tools, COALESCE(h.g, 0) AS grams, h.cap AS capacity
	FROM (
		SELECT m.uuid, m.name, COALESCE(b.name, '') AS brand_name, m.brand_slug, m.class, m.type, m.abbreviation,
			m.color_rgba, m.color_family, 'catalogue' AS src, NULL AS created_at
		FROM materials m LEFT JOIN brands b ON b.slug = m.brand_slug
		UNION ALL
		SELECT uuid, name, brand_name, '', class, type, abbreviation, color_rgba, color_family, 'custom', created_at
		FROM custom_materials WHERE owner = $1
		UNION ALL
		SELECT s.material_uuid, s.material_name, s.brand_name, '', s.class, s.type, '', s.color_rgba, s.color_family, 'copy', NULL
		FROM spools s
		WHERE s.id IN (SELECT MAX(id) FROM spools WHERE deleted_at IS NULL GROUP BY material_uuid)
			AND NOT EXISTS (SELECT 1 FROM materials WHERE uuid = s.material_uuid)
			AND NOT EXISTS (SELECT 1 FROM custom_materials WHERE uuid = s.material_uuid AND owner = $1)
	) c
	LEFT JOIN favourites f ON f.principal = $1 AND f.material_uuid = c.uuid
	LEFT JOIN (SELECT s.material_uuid, COUNT(*) AS n, SUM(s.remaining_weight_g) AS g,
			COUNT(a.spool_id) AS on_tools,
			SUM(CASE WHEN a.spool_id IS NULL THEN s.remaining_weight_g ELSE 0 END) AS free_g,
			CASE WHEN COUNT(s.full_weight_g) = COUNT(*) THEN SUM(s.full_weight_g - COALESCE(s.empty_weight_g, 0)) END AS cap
		-- assignments holds a spool at most once, so the join adds no row.
		FROM spools s LEFT JOIN assignments a ON a.spool_id = s.id
		WHERE s.deleted_at IS NULL AND s.archived_at IS NULL AND ($11 = 0 OR s.location_id = $11)
		GROUP BY s.material_uuid) h ON h.material_uuid = c.uuid
) r
WHERE ($2 = '' OR lower(r.name) LIKE $2 ESCAPE '\' OR lower(r.brand_name) LIKE $2 ESCAPE '\'
		OR lower(r.type) LIKE $2 ESCAPE '\' OR lower(r.abbreviation) LIKE $2 ESCAPE '\')
	AND ($3 = '' OR r.brand_slug = $3
		OR (r.src <> 'catalogue' AND lower(r.brand_name) = (SELECT lower(name) FROM brands WHERE slug = $3)))
	AND ($4 = '' OR r.type = $4)
	AND ($5 = '' OR r.class = $5)
	AND ($6 = '' OR r.color_family = $6)
	AND ($7 = 0 OR r.seg = 1)
	AND ($8 = 0 OR r.src = 'custom')
	AND (($9 = 0 AND $11 = 0) OR r.spools > 0)
	AND ($10 = '' OR r.uuid = $10)
	AND ($12 = 0 OR EXISTS (SELECT 1 FROM assignments a WHERE a.material_uuid = r.uuid))`

// orders are the sort keys a ListQuery may name; the name breaks ties.
var orders = map[string]string{
	"": `r.seg, CASE WHEN r.seg = 1 THEN r.starred_at END DESC, CASE WHEN r.seg = 2 THEN r.free_g END DESC,
		CASE WHEN r.seg = 3 THEN r.created_at END DESC`,
	"name":   `lower(r.name)`,
	"brand":  `lower(r.brand_name)`,
	"type":   `lower(r.type)`,
	"spools": `r.spools`,
	"weight": `r.grams`,
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// List answers one page of the materials list as principal sees it.
// ErrInvalid for an unknown order.
func (s *Store) List(ctx context.Context, principal string, q ListQuery) (Page, error) {
	if q.Color != "" && !colour.IsFamily(q.Color) {
		return Page{}, fmt.Errorf("color %q: %w", q.Color, ErrInvalid)
	}

	order, ok := orders[q.Order]
	if !ok {
		return Page{}, fmt.Errorf("order %q: %w", q.Order, ErrInvalid)
	}

	if q.Desc && q.Order != "" {
		order += " DESC"
	}

	if q.Limit <= 0 {
		q.Limit = 25
	}

	q.Limit, q.Offset = min(q.Limit, MaxPage), max(q.Offset, 0)
	args := s.filterArgs(principal, q, "")
	p := Page{}

	rows, total, err := s.rows(
		ctx,
		`ORDER BY `+order+`, lower(r.name), r.uuid LIMIT $13 OFFSET $14`,
		append(args, q.Limit, q.Offset)...)
	if err != nil {
		return Page{}, err
	}

	p.Rows, p.Total = rows, total

	// A page past the end carries no row to count on, so only then is the list counted apart.
	if len(rows) == 0 && q.Offset > 0 {
		if err = s.db.QueryRowContext(ctx, `SELECT COUNT(*)`+listFrom, args...).Scan(&p.Total); err != nil {
			return Page{}, fmt.Errorf("count materials: %w", err)
		}
	}

	if err = s.db.QueryRowContext(ctx, `SELECT COUNT(*), COALESCE(SUM(remaining_weight_g), 0) FROM spools
		WHERE deleted_at IS NULL AND archived_at IS NULL`).Scan(&p.StockSpools, &p.StockG); err != nil {
		return Page{}, fmt.Errorf("sum stock: %w", err)
	}

	if next := q.Offset + len(rows); next < p.Total {
		p.Next = &next
	}

	return p, nil
}

func (s *Store) filterArgs(principal string, q ListQuery, uuid string) []any {
	var search string
	if t := strings.TrimSpace(q.Q); t != "" {
		search = "%" + likeEscaper.Replace(s.lower(t)) + "%"
	}

	return []any{
		principal,
		search,
		q.Brand,
		q.Type,
		q.Class,
		q.Color,
		boolInt(q.Favourite),
		boolInt(q.Custom),
		boolInt(q.InStock),
		uuid,
		q.Location,
		boolInt(q.Assigned),
	}
}

// lower folds a search as the engine's lower() folds the column it is
// matched against. SQLite's folds ASCII letters only, so a search folded
// further would miss "Šedá" even in its own case.
func (s *Store) lower(t string) string {
	if s.engine == wirerpc.DatabasePostgres {
		return strings.ToLower(t)
	}

	return strings.Map(func(r rune) rune {
		if 'A' <= r && r <= 'Z' {
			return r + 'a' - 'A'
		}

		return r
	}, t)
}

// rows answers the rows tail picks, and how many rows match before the limit,
// counted by the same query.
func (s *Store) rows(ctx context.Context, tail string, args ...any) ([]Row, int, error) {
	//nolint:gosec // listFrom is a constant and tail is built by this package.
	rows, err := s.db.QueryContext(ctx, `SELECT r.uuid, r.name, r.brand_name, r.class, r.type, r.color_rgba, r.fav,
		r.src = 'custom', r.spools, r.on_tools, r.grams, r.free_g, r.capacity, COUNT(*) OVER ()`+listFrom+` `+tail, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list materials: %w", err)
	}

	defer rows.Close()

	out := []Row{}
	total := 0

	for rows.Next() {
		var r Row
		if err = rows.Scan(
			&r.UUID,
			&r.Name,
			&r.BrandName,
			&r.Class,
			&r.Type,
			&r.ColorRGBA,
			&r.IsFavourite,
			&r.IsCustom,
			&r.Spools,
			&r.AssignedSpools,
			&r.RemainingG,
			&r.FreeG,
			&r.CapacityG,
			&total,
		); err != nil {
			return nil, 0, fmt.Errorf("read material: %w", err)
		}

		out = append(out, r)
	}

	return out, total, rows.Err()
}

// Brands lists the catalogue brands by name.
func (s *Store) Brands(ctx context.Context) ([]opt.Brand, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT uuid, slug, name FROM brands ORDER BY lower(name), uuid`)
	if err != nil {
		return nil, fmt.Errorf("list brands: %w", err)
	}

	defer rows.Close()

	out := []opt.Brand{}

	for rows.Next() {
		var b opt.Brand
		if err = rows.Scan(&b.UUID, &b.Slug, &b.Name); err != nil {
			return nil, fmt.Errorf("read brand: %w", err)
		}

		out = append(out, b)
	}

	return out, rows.Err()
}

// Types lists the material types principal's list holds, catalogue and
// custom, by name.
func (s *Store) Types(ctx context.Context, principal string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT type FROM materials WHERE type <> ''
		UNION SELECT type FROM custom_materials WHERE owner = $1 AND type <> ''
		ORDER BY 1`, principal)
	if err != nil {
		return nil, fmt.Errorf("list types: %w", err)
	}

	defer rows.Close()

	out := []string{}

	for rows.Next() {
		var t string
		if err = rows.Scan(&t); err != nil {
			return nil, fmt.Errorf("read type: %w", err)
		}

		out = append(out, t)
	}

	return out, rows.Err()
}

// Material answers one material as principal sees it in the list. ErrNotFound
// when it is neither in the catalogue, nor principal's, nor held in a spool.
func (s *Store) Material(ctx context.Context, principal, uuid string) (Detail, error) {
	rows, _, err := s.rows(ctx, `LIMIT 1`, s.filterArgs(principal, ListQuery{}, uuid)...)
	if err != nil {
		return Detail{}, err
	}

	if len(rows) == 0 {
		return Detail{}, ErrNotFound
	}

	d := Detail{Row: rows[0], Packages: []PackageView{}}

	var (
		m    opt.Material
		tags string
	)

	err = s.db.QueryRowContext(ctx, `SELECT uuid, slug, brand_slug, name, class, type, abbreviation, color_rgba, density,
		hardness_shore_d, min_print_temp, max_print_temp, preheat_temp, min_bed_temp, max_bed_temp, chamber_temp,
		min_chamber_temp, max_chamber_temp, drying_temp, drying_time_min, transmission_distance, tags FROM materials
		WHERE uuid = $1`, uuid).
		Scan(&m.UUID, &m.Slug, &m.BrandSlug, &m.Name, &m.Class, &m.Type, &m.Abbreviation, &m.ColorRGBA, &m.Density,
			&m.HardnessShoreD, &m.MinPrintTemp, &m.MaxPrintTemp, &m.PreheatTemp, &m.MinBedTemp, &m.MaxBedTemp, &m.ChamberTemp,
			&m.MinChamberTemp, &m.MaxChamberTemp, &m.DryingTemp, &m.DryingTimeMin, &m.TransmissionDistance, &tags)
	if tags != "" {
		m.Tags = strings.Split(tags, ",")
	}

	switch {
	case err == nil:
		d.Material = &m
		d.Packages, err = s.packages(ctx, m.Slug)

		return d, err
	case !errors.Is(err, sql.ErrNoRows):
		return Detail{}, fmt.Errorf("read material: %w", err)
	case d.IsCustom:
		c, cerr := s.custom(ctx, principal, uuid)
		if cerr != nil {
			return Detail{}, cerr
		}

		d.Custom = &c
	}

	return d, nil
}

func (s *Store) packages(ctx context.Context, materialSlug string) ([]PackageView, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT p.uuid, p.slug, p.class, p.material_slug, COALESCE(p.container_slug, ''),
		p.net_weight_g, p.diameter_um, p.length_mm, COALESCE(p.gtin, ''), COALESCE(c.name, ''), c.empty_weight_g
		FROM packages p LEFT JOIN containers c ON c.slug = p.container_slug
		WHERE p.material_slug = $1 ORDER BY p.slug`,
		materialSlug,
	)
	if err != nil {
		return nil, fmt.Errorf("list packages: %w", err)
	}

	defer rows.Close()

	out := []PackageView{}

	for rows.Next() {
		var p PackageView
		if err = rows.Scan(&p.UUID, &p.Slug, &p.Class, &p.MaterialSlug, &p.ContainerSlug, &p.NetWeightG, &p.DiameterUM,
			&p.LengthMM, &p.GTIN, &p.ContainerName, &p.EmptyWeightG); err != nil {
			return nil, fmt.Errorf("read package: %w", err)
		}

		out = append(out, p)
	}

	return out, rows.Err()
}

func boolInt(b bool) int {
	if b {
		return 1
	}

	return 0
}
