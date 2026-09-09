# Campsite audio sources

All audio used by the campsite is made from recorded or pre-rendered CC0 files.
The runtime does not synthesize oscillators, noise, fire, wind, paper, or UI
sounds.

## Freesound recordings

| Local files | Source | Creator | License | Downloaded | Processing |
| --- | --- | --- | --- | --- | --- |
| `ambience-night.mp3` | [Forest at Night Ambience](https://freesound.org/s/587907/) | timothyd4y | CC0 1.0 | 2026-09-09 | Shortened and crossfaded into a compact loop |
| `ambience-fire.mp3` | [Campfire.wav](https://freesound.org/s/661388/) | SaschaRettberg | CC0 1.0 | 2026-09-09 | Used the selected 12-second campfire recording, moved its opening 0.6 seconds to the tail with a 0.6-second linear wraparound crossfade, and encoded an 11.4-second stereo MP3 loop at 44.1 kHz and 112 kbps |
| `tent-hover.mp3`, `ui-hover.mp3`, `ui-fullscreen.mp3` | [Button_Hover (mp3).mp3](https://freesound.org/s/251390/) | deadsillyrabbit | CC0 1.0 | 2026-09-09 | Used the complete Freesound HQ MP3 preview selected by the project owner without audio processing; all three local files are byte-for-byte identical |
| `tent-enter.mp3`, `tent-exit.mp3` | [Foley_Whoosh_Clothes.wav](https://freesound.org/s/495390/) | Nox_Sound | CC0 1.0 | 2026-09-09 | Two cloth movements selected; exit movement reversed |
| `book-open.mp3` | [Soft Cover Book Open 1.wav](https://freesound.org/s/638382/) | yossirafa100 | CC0 1.0 | 2026-09-09 | Format conversion |
| `book-close.mp3` | [cm_samples_book_close.wav](https://freesound.org/s/123819/) | assrel | CC0 1.0 | 2026-09-09 | Format conversion |
| `page-turn.mp3`, `page-land.mp3` | [Page Turn Free](https://freesound.org/s/842183/) | AardsReal | CC0 1.0 | 2026-09-09 | Full turn plus a shortened landing tail |
| `page-drag.mp3`, `page-cancel.mp3` | [Paper Rustle](https://freesound.org/s/353125/) | BenjaminNelan | CC0 1.0 | 2026-09-09 | Two short paper movements selected and faded |
| `ui-back.mp3` | [Woosh_2](https://freesound.org/s/842511/) | gulfstreamav | CC0 1.0 | 2026-09-09 | Used the complete real drumstick-through-air recording selected by the project owner, attenuated 2 dB, tail-faded, mixed to mono, resampled from 48 to 44.1 kHz, and encoded to MP3 |

Freesound's CC0 notice permits copying, modification, distribution, and
commercial use without attribution. Attribution is retained here voluntarily.

## Kenney interface sounds

Source pack: [Interface Sounds](https://kenney.nl/assets/interface-sounds) by
Kenney, licensed CC0 1.0 and downloaded 2026-09-09. The following unchanged
source variants were converted to MP3:

| Local file | Pack source file |
| --- | --- |
| `ui-click.mp3` | `click_001.ogg` |
| `ui-toggle.mp3` | `switch_003.ogg` |

## Encoding

The files are MP3 at 44.1 kHz. Most cues use 64–112 kbps encoding. The three
identical 0.076-second hover/fullscreen files retain the selected source preview's
stereo encoding and are only 3.7 KB each. MP3 was chosen for reliable decoding in
iOS Safari as well as Chromium and Firefox. Long ambience recordings were reduced
to compact loops to limit decoded memory on mobile.
