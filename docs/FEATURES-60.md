# 60 additions, ranked by impact and effort

Status: LOCAL_CONTRACTS_VERIFIED. Each app has20 new user-visible capabilities. Source-bound test results and separate browser reviews are in evidence/features-v4. This finite delivery does not establish whole-product parity.

Impact and effort are1–5 estimates. Priority score is impact ÷ effort. Foundation work may run before dependent features. Each feature requires its named behavior, persistence where relevant, and review; passing helper tests alone is insufficient.

## Docs

| Priority | Feature | Impact | Effort | Score | Acceptance |
|---|---|---:|---:|---:|---|
| 1 | D4-01 Duplicate tabs | 5 | 1 | 5 | Copy body/page settings to a fresh id; later edits independent. |
| 2 | D4-05 Replace images | 5 | 1 | 5 | Replace source while retaining display width and wrapping. |
| 3 | D4-18 RTL paragraphs | 5 | 1 | 5 | Apply LTR/RTL independently of paragraph alignment. |
| 4 | D4-04 Rotate images | 4 | 1 | 4 | Rotate pixels 90 degrees and persist new image/dimensions. |
| 5 | D4-12 Change text case | 4 | 1 | 4 | Upper/lower/title/sentence case only selected text, preserving marks. |
| 6 | D4-14 Whole-word search | 4 | 1 | 4 | Exclude partial words while retaining case setting. |
| 7 | D4-16 Paragraph borders/shading | 4 | 1 | 4 | Apply/clear border and background across selected paragraphs; HTML reload retains. |
| 8 | D4-17 Paragraph spacing | 4 | 1 | 4 | Independent before/after spacing persists through reload/export. |
| 9 | D4-19 Special characters | 3 | 1 | 3 | Insert chosen symbol at saved editor selection. |
| 10 | D4-03 Crop images | 5 | 2 | 2.5 | Apply user crop bounds to actual pixels so reload/export retain crop. |
| 11 | D4-09 Format painter | 5 | 2 | 2.5 | Capture marks/paragraph formatting and apply to another selection without changing words. |
| 12 | D4-13 Search all tabs | 5 | 2 | 2.5 | Results navigate to exact text in correct tab. |
| 13 | D4-02 Nested tabs | 4 | 2 | 2 | Indent/outdent through three levels; preserve subtrees and promote children on delete. |
| 14 | D4-06 Citation library | 4 | 2 | 2 | Add/edit/remove local source metadata and insert citations; edits refresh references. |
| 15 | D4-07 Automatic bibliography | 4 | 2 | 2 | Bibliography refreshes cited sources and supports APA/MLA/Chicago display. |
| 16 | D4-08 Bookmarks and internal links | 4 | 2 | 2 | Name position, link/navigate to it, remove marker separately. |
| 17 | D4-11 Column sections | 4 | 2 | 2 | Wrap selected blocks in 2/3 columns; unwrap without losing contents. |
| 18 | D4-15 Regex find/replace | 4 | 2 | 2 | Validate patterns, ignore zero-length matches safely, support numbered replacement groups. |
| 19 | D4-20 Sort paragraphs | 3 | 2 | 1.5 | Sort complete selected paragraphs both directions, preserving marks; reject mixed structures. |
| 20 | D4-10 Rendered equations | 4 | 3 | 1.33 | Editable bounded fractions/roots/powers/subscripts/Greek render as MathML; unsupported syntax errors. |

## Sheets

| Priority | Feature | Impact | Effort | Score | Acceptance |
|---|---|---:|---:|---:|---|
| 1 | S4-10 Trim whitespace cleanup | 4 | 1 | 4 | Trim and collapse whitespace in selected literal text without rewriting formulas. |
| 2 | S4-11 Format painter | 4 | 1 | 4 | Capture one cell style and paint another selection in one action without changing values. |
| 3 | S4-13 Alternating row colors | 4 | 1 | 4 | Apply a header color and alternating body fills over a selected table, preserving values. |
| 4 | S4-14 Cell notes | 4 | 1 | 4 | Save, inspect and remove a cell note with visible grid indicator. |
| 5 | S4-18 Freeze through selection | 4 | 1 | 4 | Freeze multiple rows and columns through the selected cell and retain their offsets on scroll. |
| 6 | S4-17 Text case cleanup | 3 | 1 | 3 | Convert literal text to upper/lower/title case while preserving formulas, numbers and formatting. |
| 7 | S4-19 Sheet tab colors | 3 | 1 | 3 | Choose a saved worksheet tab color that remains visible after switching sheets. |
| 8 | S4-01 Per-column filters | 5 | 2 | 2.5 | Combine independent column criteria with AND while keeping the header visible. |
| 9 | S4-02 Saved filter views | 5 | 2 | 2.5 | Save, restore and delete named column-filter configurations after reopening JSON. |
| 10 | S4-03 Multi-column sort | 5 | 2 | 2.5 | Sort selected table by ordered ascending/descending keys without separating row cells. |
| 11 | S4-04 Checkbox cells | 5 | 2 | 2.5 | Insert toggleable checkbox cells whose TRUE/FALSE values feed formulas and persist. |
| 12 | S4-05 Find and replace | 5 | 2 | 2.5 | Replace matches in selection, sheet or workbook with case/whole-cell options and formula opt-in. |
| 13 | S4-08 Remove duplicate rows | 4 | 2 | 2 | Choose key columns and header handling; compact unique rows while preserving complete cell objects. |
| 14 | S4-09 Split text into columns | 4 | 2 | 2 | Split a selected text column by delimiter with quoted-field handling and safe destination checks. |
| 15 | S4-15 Cell hyperlinks | 4 | 2 | 2 | Attach and safely open an HTTP/HTTPS/mailto link without losing the cell value. |
| 16 | S4-16 Paste transposed cells | 4 | 2 | 2 | Paste a copied rectangle with rows/columns swapped and formula-relative references adjusted. |
| 17 | S4-06 Custom-formula conditional formatting | 5 | 3 | 1.67 | A relative formula evaluates per target cell, including cross-column conditions. |
| 18 | S4-07 Custom-formula data validation | 5 | 3 | 1.67 | Reject a proposed edit when its relative custom formula is false or errors, without changing saved cells. |
| 19 | S4-20 Fill business days | 3 | 2 | 1.5 | Fill dates forward while skipping Saturday/Sunday and preserving the first selected date. |
| 20 | S4-12 Formula-safe cut | 5 | 4 | 1.25 | Move cells and retarget dependent scalar and fully-contained range references across sheets, preserving anchors and literals; reject unsupported partial-range moves atomically. |

## Slides

| Priority | Feature | Impact | Effort | Score | Acceptance |
|---|---|---:|---:|---:|---|
| 1 | L4-06 Replace image in place | 5 | 1 | 5 | Replace a selected local image while retaining its id, position, size, rotation, mask, crop, appearance and group. |
| 2 | L4-11 Lock objects | 4 | 1 | 4 | Lock selected objects against drag, resize, keyboard movement and delete; unlock through object list/format controls; lock persists. |
| 3 | L4-15 Skip hidden slides | 4 | 1 | 4 | Hide/unhide slides in filmstrip; editing retains them and live/HTML presentation skips them forward/back; no empty-deck dead end. |
| 4 | L4-17 Equal object distribution | 4 | 1 | 4 | Distribute three or more unlocked selected objects horizontally/vertically with equal gaps, preserving endpoints, content and unselected geometry. |
| 5 | L4-01 Cross-slide object clipboard | 5 | 2 | 2.5 | Copy/cut selected objects, switch slides and paste preserving styles, groups and connector membership; cut clears only after a valid paste and stale sources reject. |
| 6 | L4-08 Format painter | 5 | 2 | 2.5 | Capture an object's appearance and paint another compatible object or selection without copying content or geometry; undo restores the target. |
| 7 | L4-04 Paragraph layout controls | 4 | 2 | 2 | Change line spacing, space before/after and vertical text alignment while retaining text and inline styles; presentation/export geometry follows. |
| 8 | L4-07 Image masks | 4 | 2 | 2 | Apply ellipse/rounded/rectangle masks to images, retain crop and show the mask in presentation/SVG/HTML/PPTX. |
| 9 | L4-12 Object and slide hyperlinks | 4 | 2 | 2 | Attach safe website/mail links or an internal slide target; activating during presentation opens the link or jumps to the slide without advancing accidentally; unsafe protocols reject. |
| 10 | L4-13 Deck find and replace | 4 | 2 | 2 | Find text across slides, jump to matches and replace one/all while preserving unrelated rich text; notes optionally included; undo restores edits. |
| 11 | L4-14 Automatic footer and slide numbers | 4 | 2 | 2 | Set a deck footer, number start and visibility; all slides derive correct numbers through reorder and show them in presentation/exports. |
| 12 | L4-18 PNG slide export | 4 | 2 | 2 | Download the current slide as a real PNG at selectable1x/2x resolution with current rich text/crop/footer/background; decode failure is surfaced. |
| 13 | L4-19 Append slides from a local deck | 4 | 2 | 2 | Append JSON/PPTX slides to the current deck without replacing existing authored slides; remap object/group/slide/link identifiers and scale aspect ratios. |
| 14 | L4-20 Photo slide backgrounds | 4 | 2 | 2 | Choose a local background image, cover/contain and opacity; replace/remove it while objects remain; presentation and exports include it. |
| 15 | L4-03 Structured bulleted and numbered lists | 5 | 3 | 1.67 | Toggle real bullets/numbering and indent/outdent selected paragraphs; nesting and numbering render in presentation and exports. |
| 16 | L4-05 Nondestructive image crop | 5 | 3 | 1.67 | Crop using a normalized visible rectangle and reposition it, reset without changing original source; editor/presentation/exports show the same crop. |
| 17 | L4-16 Named slide sections | 3 | 2 | 1.5 | Assign section names, show section headings and collapse/expand sections without changing slide content or order. |
| 18 | L4-09 Smart snapping guides | 4 | 3 | 1.33 | Moving a selection near slide/object edges or centers snaps within a tolerance and displays guides; toggle disables snapping. |
| 19 | L4-10 Attached connectors | 4 | 3 | 1.33 | Connect two objects with an arrow that follows their move/resize; duplicate/paste remaps endpoints and deletion handles missing endpoints safely. |
| 20 | L4-02 Per-word rich text | 5 | 4 | 1.25 | Select a word, apply bold/italic/underline/color/font/size without changing neighboring words; content persists and appears in HTML/SVG/PPTX. |

## Shared additions

- Save the current file as a reusable local template and create independent files from it.
- Insert a local Sheets range or chart into Docs/Slides, retain source identity, and refresh explicitly while preserving placement.

Accounts, sharing, credential-dependent services and cloud AI remain excluded. Whole-product Google/Office parity remains unproven.
