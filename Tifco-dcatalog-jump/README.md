# Tifco Catalog Jump (DCatalog deep-link search)

This tool gives you a searchable box that returns **page links** into the DCatalog viewer.

It does **not** scrape DCatalog.
Instead, it indexes the **catalog PDF** locally into a JSON search index, then generates links like:

`.../v/TIFCO---Interactive-Product-Catalog---Vol-22/?page=123`

## Setup
1) Put your full catalog PDF in this folder as: `catalog.pdf`
2) Run: `python build_index.py`
3) Commit the generated `catalog_search_index.json`
4) Host this folder (GitHub Pages)

## Config
Edit `config.js` and set `window.DCATALOG_BASE_URL` to the catalog URL.

## Notes
- Works best when the PDF contains real text. If the PDF is scanned images, you'll need OCR first.
- Page numbering is assumed to match DCatalog's `?page=` parameter (common for DCatalog viewers). citeturn5view0
