# Photograph Inventory & Proposed Action Map

**Source:** `D:\桌宠\Raw Lab Image\` — 20 JPEG files, all `微信图片_2026091413*.jpg`
**Reviewed:** by eye, all twenty, on the vision model. Every label below is my reading and is **yours to correct**.
**Status:** provisional. Nothing has been copied, renamed or edited.

---

## 1. Measured facts

- **EXIF is stripped from all twenty.** No capture date, no camera, no orientation. The filenames are WeChat *save* times (all within two minutes), not capture times.
- **One exception recovered visually:** file `…130401` is a **phone screenshot** of a photo viewer, and its header bar reads **2024年9月12日 19:53**. That is a genuine capture timestamp — recovered by looking, because the metadata was gone. If other photographs were saved the same way, the same trick works.
- **16 portrait, 4 landscape** (`…130409`, `…130417`, `…130419`, `…1304221`).
- Five distinct resolutions: 1279×1706, 1120×1494, 1492×1120, 810×1440, 1080×1440, plus the 1280×2800 screenshot.
- The dog reads as an adult yellow Labrador with a chocolate nose and a whitish muzzle.

---

## 2. The twenty, one by one

| # | file | what is in it | proposed action | type |
| --- | --- | --- | --- | --- |
| 01 | `…130401` | **Screenshot, not a photograph.** A photo viewer showing the dog standing full-body on pale floor boards, three-quarter view facing left, tongue out, tail up and blurred. Time header 2024-09-12 19:53; app toolbars top and bottom. | `stand` | full body |
| 02 | `…130402` | Tight head close-up: lying flat, head raised toward the camera, tongue fully out licking his nose across it. | `lick` (face) | **bust** |
| 03 | `…130404` | Lying on the floor with the head down and resting between a person's dark-clad legs; eyes closed, forelegs stretched forward. | `rest` / `sleep` | full body |
| 04 | `…130405` | Sitting, looking up at the camera with a slight head tilt, mouth closed — curious. A person lies curled asleep on a brown fluffy bed behind. | `look-up` / `curious` | full body |
| 05 | `…130406` | Walking, mid-stride, side-on toward the left, head level, in front of the same sleeping person and bed. | `walk` | full body |
| 06 | `…130407` | In the car, front paws up on the centre console, harness with a red tag, tongue out, panting. Grey plaid seat cover, trees beyond the windscreen. | `car` | half body |
| 07 | `…130408` | The car again — **same moment as 06**, marginally different framing. | `car` (2nd frame) | half body |
| 08 | `…130409` | Head in profile facing right, mouth open panting, on a wooden deck with grass behind. Landscape. | `pant` | **bust** |
| 09 | `…130412` | Sitting on the living-room floor, seen from the side/behind, facing away-left. | `sit-side` | full body |
| 10 | `…130413` | Sitting facing the camera, head up, on the living-room floor; white staircase behind. | `sit` | full body |
| 11 | `…130414` | Sitting facing the camera, head slightly lowered, blue toy in the foreground; the photographer's dark clothing at the bottom edge. | `sit` (variant) | full body |
| 12 | `…130415` | Overhead view of the dog walking with its head down, sniffing along a door threshold; **head is motion-blurred**. 9:16. | `sniff` | full body |
| 13 | `…130416` | Sitting facing the camera, head up, a purple exercise ball directly behind the head; TV and display cabinet behind. | `sit` (variant) | full body |
| 14 | `…130417` | Lying on the white leather sofa, head up, looking at the camera, forelegs crossed forward, blue towel beneath. Landscape. | `lie-sofa` | half body |
| 15 | `…130419` | The same sofa, nearly the same pose, slightly different framing. | `lie-sofa` (2nd frame) | half body |
| 16 | `…130420` | The same sofa, lying with the head turned away to the right, resting, one hind leg out. | `lie-away` | half body |
| 17 | `…1304201` | The same sofa, curled up with the head tucked down against the sofa arm, asleep, hind leg stretched out. | `sleep-sofa` | half body |
| 18 | `…130422` | Tight portrait: sitting facing the camera head-on, direct eye contact, calm expression. Lower body hidden behind a cream sofa edge. 9:16. | `look-at-you` | **bust** |
| 19 | `…1304221` | **Wearing a pink inflatable cone**, lying on the floor, forelegs stretched forward, looking at the camera. Landscape. | `cone-lying` | full body |
| 20 | `…130516` | Close-up: the cone again, with a white/pink padded wrap and plush padding around the head and ear, a printed card with English text alongside. | `cone-closeup` | **bust** |

---

## 3. What the set actually gives us

**Groups from the same session — useful, because they share a background and a scale:**

- **Living room, sitting:** 09, 10, 11, 13, 18 — five poses, same floor, same light. This is the backbone of a repertoire.
- **The sofa:** 14, 15, 16, 17 — lying, four variants.
- **The bed / sleeping person:** 04, 05 — a sitting look-up and a walk.
- **The car:** 06, 07 — genuinely the same instant, the only true two-frame pair in the set.
- **The cone:** 19, 20 — two views of the same period.

**Actions with real coverage:** sitting (5+), lying (6), looking at the camera (several), walking (2), panting (2–3), sleeping (3).

**Actions with no coverage at all:** begging, shaking, rolling over, barking, tail-wagging as a pose, playing with a toy, eating, running, jumping, turning.

---

## 4. Two design consequences I did not expect

### 4.1 There are two kinds of photograph in one set
Files 02, 08, 18 and 20 are **bust shots** — head and shoulders. Files 01, 03, 04, 09, 10, 11, 12, 19 are **full body**. You cannot put a head close-up on the same floor line as a full-body standing pose; scaled to match, a hairless giant head would sit next to a dog. The action model therefore needs a **shot type** on every action:

- `body` — usable as the creature on the desktop.
- `bust` — used for speech bubbles, notifications, the settings preview, the "he's looking at you" moment.

Both are valuable; they are simply not interchangeable.

### 4.2 There is no walking burst
Files 05 and 12 both show walking, but from completely different camera positions, distances and angles. Playing them in sequence will jitter badly. So my earlier warning stands: **ship with movement off** unless you shoot or supply 3–6 frames of one walk at a fixed camera. `05` alone, held with a bob, is the acceptable fallback.

A minor third point: file 20 carries a printed card with **readable English text**, and file 01 carries app UI text. Anything with text must be flagged `noMirror` or it will render mirrored and illegible.

---

## 5. Proposed starting repertoire

| action | category | frames | weight | note |
| --- | --- | --- | --- | --- |
| `sit` | ambient | 10, 13, 11, 18 *(pick 1–2)* | 25 | the backbone pose |
| `look-up` | ambient | 04 | 15 | the "he noticed you" pose |
| `rest` | ambient | 03 | 12 | head down, eyes closed |
| `lie-sofa` | ambient | 14, 15, 16 | 12 | |
| `sleep` | ambient | 17 | 6 | |
| `sniff` | ambient | 12 | 6 | blurred head — use with care |
| `lick` | click | 02 | — | bust; a click reaction |
| `pant` | event | 08 | — | bust |
| `car` | ambient | 06, 07 | 4 | the only 2-frame action available |
| `cone-lying` | event | 19 | — | see the question below |
| `cone-closeup` | event | 20 | — | bust; carries text |

Movement category: **empty by default.**

---

## 6. Open questions for Raymond

1. **Are my labels right?** Correct any of them; I will use your names as the labels.
2. **The cone photographs (19, 20).** Keep them, and if so as an occasional "not feeling well" action — or leave them out of the rotation entirely?
3. **The screenshot (01).** Crop the phone UI out and use the standing pose, or discard it?
4. **Which sitting shot is *the* sitting shot?** Five candidates, and I would rather you chose than me.
5. **His name**, for the bubbles and the settings page.
