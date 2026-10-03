# Voice Setup Guide — local AI character voices for Witch Cult Reader

This guide gets the Read-aloud feature reading Re:Zero chapters with AI voices of the actual characters, generated 100% on your own desktop (no cloud, no API key, no cost). Target hardware used for this guide: NVIDIA RTX 3050 8GB, 32GB RAM, 12th-gen i7 — but anything with a 6GB+ NVIDIA GPU works.

There are two building blocks:

1. **The engine** — [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS), the open-source voice AI the anime community standardised on. It turns "a 5-second clip of a character + what that clip says" into that character reading any text you give it.
2. **The voices** — either short **clips** of each character (zero-shot, 2-minute setup per character) or **trained character packs** that the community has already made for Re:Zero characters (best fidelity, automatic weight-switching supported by the extension).

---

## Part A — Install GPT-SoVITS on the desktop (one time, ~15 min)

1. Download the **Windows integrated package** from the official releases page:
   `https://github.com/RVC-Boss/GPT-SoVITS/releases`
   Grab the latest `GPT-SoVITS-v2xxx-xxxx.zip`-style Windows integrated package (~2-3 GB download, ~6 GB unzipped). It bundles Python, PyTorch and all dependencies — no environment setup needed.
2. Unzip to a path **without spaces or non-ASCII characters**, e.g. `C:\GPT-SoVITS`. (Right-click the zip → Extract All. If your unzip tool complains about the zip being large, use [7-Zip](https://www.7-zip.org/).)
3. The v2 pretrained base models are included in the integrated package. If you ever installed from source instead, download them from `https://huggingface.co/lj1995/GPT-SoVITS` into `GPT_SoVITS/pretrained_models/`.
4. Sanity check: run `go-webui.bat` once, click around, then close it. (Not required, but proves the GPU stack works.)

**RTX 3050 notes:** the v2 pipeline needs about 4-5GB VRAM at default batch size — fits with headroom. If you later try v3/v4 configs (better quality), close other GPU apps first; they want 6-8GB. CPU-only also works but each sentence takes several seconds.

## Part B — Get Re:Zero character voices

### Route 1: character clips (zero-shot) — fastest, surprisingly good

A "voice" is just a clean 5-10 second clip of one character speaking, plus its transcript.

1. Make a folder `C:\voices`.
2. For each character you want (start with narrator, Subaru, Emilia, Rem, Ram, Beatrice, plus `???` for masked speakers), save one WAV/MP3 clip: **dialogue only, no music, no sound effects, no second voice**.
   - **For English reading, prefer clips from the English dub** — you get the EN cast's actual voices *and* native English prosody (Subaru = Sean Chiplock, Emilia = Kayli Mills, Rem = Brianna Knickerbocker, Ram = Ryan Bartley, Beatrice = Cristina Vee). Japanese clips also work cross-lingually but keep a slight accent.
   - Cut clips from episodes you have (any editor: [LosslessCut](https://mifi.no/losslesscut/) is the easiest; Audacity works too). Name files like `subaru.wav`, `rem.wav`.
3. Write down **exactly what is said** in each clip — the transcript must match the audio word-for-word (this is the `prompt`). Keep clips 5-10s; 3-9 seconds is the sweet spot.

### Route 2: trained character packs — best fidelity, already made by the community

The community has trained full GPT-SoVITS models for popular Re:Zero characters. Each **pack** contains a GPT checkpoint (`.ckpt`), a SoVITS model (`.pth`), and usually a reference clip + prompt text. Places to look:

- **aihobbyist / GPT-SoVITS_Model_Collection** (ModelScope): `https://www.modelscope.cn/models/aihobbyist/GPT-SoVITS_Model_Collection` — 870+ community models organised by anime/game, with an online trial (`tts.aihobbyist.com`) so you can listen before downloading.
- **aivoices.gg** GPT-SoVITS catalog: `https://aivoices.gg/frameworks/gpt-sovits` — searchable by character.
- **WLWolf56/gpt-sovits-model** (HuggingFace): `https://huggingface.co/WLWolf56/gpt-sovits-model` — anime-organised model folders.
- **HuggingFace search**: `https://huggingface.co/models?search=gpt-sovits` plus terms like `Re:Zero`, `レム` (Rem), `ラム` (Ram), `エミリア` (Emilia), `ナツキ・スバル` (Subaru).
- **Bilibili**: search `Re0 GPT-SoVITS 模型分享` — creators post full packs; demo site `tts.acgnai.top` hosts many anime characters to preview.

Download a pack per character and unzip it into e.g. `C:\GPT-SoVITS\CharacterPacks\rem\` (keep each pack's files together and note the full paths of the `.ckpt` and `.pth`).

**How packs interact with the reader:** when a preset includes `gpt` + `sovits` paths, the extension automatically calls the server's weight-loading endpoints each time the speaker changes, then synthesises. The first line after a speaker change pauses ~2-5s while the model swaps in VRAM; consecutive lines by the same speaker are instant. Mix freely: give some characters packs and others clips. Voices *without* `gpt`/`sovits` reuse whatever weights are currently loaded.

## Part C — Wire it into the extension

1. On the desktop, start the API server (from the GPT-SoVITS folder):
   ```
   python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
   ```
   The integrated package also has a `go-api.bat` that launches the same thing. Wait for the model-loading lines to finish (first launch takes ~30-60s).
2. In the browser on a chapter: open **✦ Reader → Read aloud**:
   - **Voice engine** → *Local AI server*
   - **Server address** `http://127.0.0.1:9880`, **Server type** → *GPT-SoVITS (api_v2)*
   - Press **Test** — "Server reachable" means the connection works.
3. Press **Cast template** — it fills a preset slot for every speaker in the current chapter. Edit the JSON (or start from `local-voices-template.json` in the extension folder):

   Zero-shot clips:
   ```json
   {
     "narrator": {"ref": "C:/voices/narrator.wav", "prompt": "what the narrator clip says", "lang": "en"},
     "Rem":      {"ref": "C:/voices/rem.wav",      "prompt": "what Rem says in her clip",     "lang": "en"},
     "???":      {"ref": "C:/voices/mystery.wav",  "prompt": "...", "lang": "en"}
   }
   ```
   Trained packs (add `gpt`/`sovits`; `ref`/`prompt` come with the pack):
   ```json
   {
     "Rem": {"gpt": "C:/GPT-SoVITS/CharacterPacks/rem/rem.ckpt",
             "sovits": "C:/GPT-SoVITS/CharacterPacks/rem/rem.pth",
             "ref": "C:/GPT-SoVITS/CharacterPacks/rem/ref.wav",
             "prompt": "transcript from the pack", "lang": "ja"}
   }
   ```
   Use forward slashes in paths. `lang` is the language **of the clip** (`ja` for Japanese-cast packs, `en` for dub clips). Characters you skip fall back to the narrator.
4. **Apply presets**, then click any line — it reads as a play, each character in their own voice, following along and highlighting. **Speed** is applied server-side (no pitch artifacts).

## Part D — Troubleshooting

| Symptom | Fix |
|---|---|
| "Cannot reach server" | The `python api_v2.py ...` window must stay open. Re-check the port matches the panel's address. |
| First line takes forever | Normal: model warm-up. Later lines are fast (the next sentence is prefetched while the current one plays). |
| `ref_audio_path is required` / 400 | A preset is missing `ref` (narrator included) or the JSON didn't apply — press **Apply presets** again and watch the status line. |
| Voice sounds wrong / garbled | Transcript doesn't match the clip, or the clip has music/noise. Re-cut a cleaner clip; keep 5-10s. |
| Accented English from JP packs | Expected with Japanese-cast packs (cross-lingual). Use EN-dub clips or EN-trained packs for pure English. |
| Long pause whenever the speaker changes | That's the character-pack weight swap (2-5s). Use zero-shot clips for a fast back-and-forth, or packs only for main characters. |
| Out of memory (VRAM) | Close other GPU apps; stay on the v2 config; reduce batch to 1 (default in our requests). |
| Paths with spaces | Quote them in the server launch command; in the presets JSON just use forward slashes — spaces are fine there. |

Everything runs on `127.0.0.1` only: the extension's background worker is the sole caller, and the website itself cannot reach your server. No text or audio leaves your machine.

## Alternative engine: Style-Bert-VITS2

If you prefer per-character model files with no ref clips: [Style-Bert-VITS2](https://github.com/litagin02/Style-Bert-VITS2) (~2GB VRAM). Run `python server.py --api` (default `http://127.0.0.1:5000`), set **Server type** → *Style-Bert-VITS2* in the panel, and press **Load character models** — it auto-matches downloaded model names to the chapter's cast. Presets use `{"model": "name", "style": "Neutral"}`. Re:Zero models are findable via the same catalogs above (filter by Style-Bert-VITS2).
