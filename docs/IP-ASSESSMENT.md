# Patentability assessment — Lookup

**Prepared 2026-08-17. This is engineering research, not legal advice, and I am not
a patent attorney. Every conclusion below needs a qualified practitioner to
confirm before you rely on it or spend money on it.**

The short version: **patents are a poor fit for this project.** Two independent
reasons, either of which would be enough on its own, plus a hard deadline that
applies if you disagree with me and want to try anyway.

---

## 1. The clock, which is the one time-critical fact

First commit: **2026-07-29**. The repository has been public since then
(`githubRepoVisibility: public` on every deployment record), and the app has been
live on public URLs.

A public GitHub repository is a public disclosure under patent law — this is not a
grey area, and it is called out explicitly in practitioner guidance.

| Jurisdiction | Effect of the 2026-07-29 disclosure |
| --- | --- |
| **United States** | Recoverable. 35 U.S.C. § 102(b)(1) gives a 12-month grace period for the *inventor's own* disclosure. **Deadline ≈ 2027-07-29.** |
| **India** | Novelty already destroyed for everything disclosed on 2026-07-29. India applies absolute novelty; the s.31 exhibition exception does not cover this. |
| **EPO / China / Japan** | Same — absolute novelty, no general grace period. |

So: anything already published is unpatentable outside the US. Only material
**not yet disclosed** could be filed elsewhere, and only if filed *before*
publication.

## 2. Subject matter — the harder problem

The likely home jurisdiction is India, where **s.3(k) of the Patents Act 1970**
excludes "a mathematical or business method or a computer programme per se or
algorithms." Courts have softened this: a CRI escapes s.3(k) if it makes a
*technical contribution* — solving a technical problem, enhancing a technical
process, or delivering some other technical benefit. But that is the bar this
project has to clear, and most of it does not come close, because most of it is
either third-party or textbook:

- **SGP4/SDP4** — NORAD, public domain, via `satellite.js`
- **Planetary positions** — VSOP87 via `astronomy-engine`
- **Star and constellation data** — d3-celestial, BSD-3
- **Kepler, vis-viva, Hohmann transfers, Kasten–Young air mass (1989)** — textbook
- **Rendering** — three.js

## 3. Prior art found against the specific candidates

I searched the actual candidates rather than guessing. Each was killed by
published prior art:

| Candidate | Prior art | Verdict |
| --- | --- | --- |
| Adaptive-step conjunction screening with altitude-band pre-filter | Hoots, Crawford & Roehrich, *An analytic method to determine future close approaches between satellites*, Celestial Mechanics 33 (1984) — a three-filter sequence whose **first filter is a perigee/apogee computation on both objects**. Our band filter is that filter. | Anticipated |
| AR sky view driven by device orientation | US20070283583A1 (celestial object identification device, three-axis magnetic + gravity sensors); US20130010068A1; US8638223 (mobile communicator with orientation detector). Crowded field with 15+ years of filings. | Crowded, likely anticipated |
| Hermite interpolation of SGP4 state vectors to avoid per-frame propagation *(the optimisation implemented today)* | **Standardised prior art.** SPICE SPK data types 9, 13, 18 and 19 are Hermite interpolation of state vectors; CCSDS OEM (502.0-B-2) has an `INTERPOLATION_METHOD = HERMITE` field. Decades old and written into file-format standards. | Anticipated |
| Provenance/degradation model (`live` / `cache` / `file` / `fixture`, epoch age, honest "unavailable" states) | Not searched exhaustively, but this is presentation of information and organisation of data — squarely the kind of thing s.3(k) and *Alice* exclude. | Poor |

The staggered per-object refresh phase (see below) is the narrowest thing I could
not immediately anticipate. I would still expect an examiner to call it obvious:
time-slicing work across frames and double-buffering are both standard, and
spreading cache expiry to avoid a thundering herd is a well-known pattern well
outside astrodynamics.

## 4. What I would actually protect instead

- **Copyright** already subsists automatically in the source. Add a `LICENSE` —
  the repo currently has none, which means nobody, including you, has clear terms.
  This is the single highest-value IP action available and it costs nothing.
- **Trademark** on the name and any logo, if the product matters commercially.
  Cheap, fast, and it is what actually stops a competitor trading on your name.
- **Speed and data**: the defensible asset here is the accuracy work and the
  audit trail behind it — the measurements in the README that show which figures
  have been checked against an independent source. That is a reputation moat, not
  a patent one.

## 5. If you want to file anyway

That is a legitimate call — a US provisional is cheap and buys twelve months.

1. **Engage a patent attorney** with software/CRI experience. Nothing here
   substitutes for that.
2. **File a US provisional before 2027-07-29.** Micro-entity fees are modest.
3. **Stop publishing anything you intend to claim.** Anything new, kept
   unpublished until filing, is still patentable everywhere — including India. That
   is the only route to non-US protection now.
4. **Commission a real novelty search.** My four searches are a first pass over
   published literature and Google Patents; they are not a professional search of
   patent families, continuations, or non-English filings.

## 6. The invention record, for whatever it is worth

If you do consult an attorney, this is what they will ask for. Stated at its
strongest *and* with its weaknesses, because presenting it otherwise would waste
your money.

**Problem.** Animating a full orbital-debris catalogue in a browser is
propagation-bound. The app admits this in its own UI: the catalogue is "more than
half an animation frame of propagation before anything is drawn." Re-running SGP4
for every object every tick capped how much could be displayed.

**Mechanism.** SGP4 returns a velocity with every position. Two calls bracketing a
short window therefore supply both endpoints *and* both derivatives — exactly the
input a cubic Hermite needs — so every tick inside the window becomes arithmetic
instead of a propagation. Each object's window is aligned to a grid (so scrubbing
backwards and forwards across an instant cannot shift the field) and the grid
phase is **offset per object**, so windows expire at staggered times rather than
all at once. Without the stagger the saving becomes a periodic stall the size of
the full-catalogue propagation it was meant to remove.

**Measured effect** — 1,200 real Fengyun-1C fragments, 250 ms tick:

| Window | Worst error | Mean error | SGP4 calls per object |
| --- | --- | --- | --- |
| 2 s | 2.92 m | 0.07 m | 2 instead of 9 |
| 4 s | 5.72 m | 0.10 m | 2 instead of 17 |
| **8 s** (shipped) | **11.44 m** | **0.09 m** | **2 instead of 33** |
| 16 s | 22.63 m | 0.11 m | 2 instead of 65 |
| 32 s | 45.28 m | 0.18 m | 2 instead of 129 |

Eight seconds of ticks: **31 ms → 3 ms, 9.2×**. In the browser, 12,500 objects
render at 10.6 fps under a software rasteriser with no errors.

**Why the error is acceptable, stated properly.** 11.4 m at a typical 800 km slant
range subtends 0.003° — about a twentieth of a pixel on this dome. The TLE that
produced it carries kilometres of along-track error in its own right, so the
interpolation error sits roughly three orders of magnitude below the error already
in the input. That is what makes it a fair trade rather than a shortcut.

**Weakness, stated plainly.** The technique is standardised prior art (SPICE SPK
9/13/18/19, CCSDS OEM). Only the staggered-phase scheduling is arguably new, and
I would expect it to be held obvious.

---

## Sources

- [MPEP 2152 — AIA 35 U.S.C. 102(a) and (b)](https://www.uspto.gov/web/offices/pac/mpep/s2152.html)
- [The US one-year grace period after public disclosure](https://www.patentext.com/blog/patent-after-public-disclosure/)
- [Grace-period divergence between the US and other jurisdictions](https://www.dbllawyers.com/the-grace-period-clock-when-patenting-after-your-own-public-disclosure-divergence-between-the-united-states-and-foreign-countries/)
- [Indian Patent Office — 2017 CRI Guidelines (PDF)](https://ipindia.gov.in/writereaddata/Portal/IPOGuidelinesManuals/1_86_1_Revised__Guidelines_for_Examination_of_Computer-related_Inventions_CRI__.pdf)
- [India — court clarifies "technical contribution" for CRIs](https://www.mirandah.com/india-court-clarifies-the-criteria-of-technical-contribution-in-relation-to-computer-related-inventions/)
- [Section 3(k): overview of non-patentable inventions](https://thelegalschool.in/blog/section-3k-patents-act)
- [Hoots, Crawford & Roehrich (1984), Celestial Mechanics 33](https://link.springer.com/article/10.1007/BF01234152)
- [Space debris collision avoidance using a three-filter sequence, MNRAS 442](https://academic.oup.com/mnras/article/442/4/3235/1345518)
- [US20070283583A1 — Celestial object identification device](https://patents.google.com/patent/US20070283583)
- [US20130010068A1 — Augmented reality system](https://patents.google.com/patent/US20130010068A1/en)
- [US8638223 — Mobile communicator with orientation detector](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8638223)
- [SPICE SPK tutorial — Hermite data types 9/13/18/19 (PDF)](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/Tutorials/pdf/individual_docs/18_spk.pdf)
- [OEM2SPK user's guide — CCSDS OEM `INTERPOLATION_METHOD = HERMITE`](https://naif.jpl.nasa.gov/pub/naif/utilities/SunSPARC_32bit/oem2spk.ug)
