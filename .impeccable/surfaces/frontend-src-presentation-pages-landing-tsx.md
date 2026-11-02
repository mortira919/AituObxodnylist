---
version: 1
slug: "frontend-src-presentation-pages-landing-tsx"
primary_target: "frontend/src/presentation/pages/Landing.tsx"
related_targets: ["frontend/src/presentation/pages/Student.tsx","frontend/src/presentation/pages/Office.tsx","frontend/src/presentation/pages/admin/Sheets.tsx","frontend/src/presentation/pages/Verify.tsx","frontend/src/presentation/pages/Login.tsx"]
---

# Surface brief: AITU College clearance sheet web app

Scope: public landing `/` (Persuade), cabinets `/student`, `/office`, `/admin` (Operate), public verification `/verify/:number` (Operate). One visual world across all.

Audience: landing for college administration (director, deputy for academic work) and the defense commission; actions are signing in and verifying a document. Cabinets for student (phone first), department officer (desktop, batch work), academic office admin. Verification for anyone holding the PDF.

Proof: no real customers or numbers exist. Demo data is synthetic and labeled as demo. Targets are phrased as goals.

Memorable moment: department marks get their state in parallel, the library one shows a debt, then the closed sheet is stamped with the AITU seal beside its QR.

Login: college login + password, httpOnly session cookie (decided 2026-10-29). Working screens: login, account, sheet detail, admin students/staff/templates/audit.

Brand: AITU College (pinned by the user 2026-10-29). Official AITU logo, colors #001c46 and #1385e5.

## Direction contract

THESIS: Every department marks the sheet in parallel; the closed sheet receives the AITU College seal with its number and date, checked by QR. Refuses the SaaS split hero with three icon cards and the grey government portal.

OWN-WORLD: Translated into the pinned AITU brand: AITU night navy #001C46 fields (with a faint dot grain) replace desert patina, marks in light blue #6CB6FF and white on night; pale cool paper #EEF2F7 working ground; AITU blue #1385E5 for graphics and the seal emblem accent, its darkened #0A66B8 for buttons and blue text (AA); oxide #C0352B only for debt. Department marks are recognizable lucide icons (book, wallet, house, shield, laptop, graduation cap) in a circle; the user rejected invented glyphs as misleading. State never by tint alone: pending is a dashed ring, cleared a solid blue ring with a check badge, debt a solid oxide ring with an exclamation badge. The closed sheet carries a round seal: AITU emblem, ring text, number and date. No cards, no shadows, baseline grid; hairlines separate table rows and list rows. Geologica: sharp axis for display, standard for UI.

STORY: The administrator sees the paper round of offices turn into parallel marks, believes the closed sheet is verifiable, and signs in.

FIRST VIEWPORT: Full-bleed AITU night. Left half: H1, one line of support, primary «Войти» (blue-ink) and secondary «Проверить документ». Right half: a live demo sheet; six department marks peck in parallel, the library one breaks with a debt line, then resolves, and the sheet is stamped with the AITU seal beside its QR. RU/KZ switch in the top bar.

Raises: billing-rank scale (one huge status figure, agate audit block); state by shape not tint; no enclosure; a fresh state badge fades in on change.

FORM: Тамга, position 5 of the ordered list, seed a7b380f7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
