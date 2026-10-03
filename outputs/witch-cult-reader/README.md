# Witch Cult Reader - Chrome / Edge

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions` (Chrome) or `edge://extensions` (Edge).
3. Enable **Developer mode**, click **Load unpacked**, and select the folder containing `manifest.json`.
4. Open or refresh a Witch Cult Translations chapter. Click **✦ Reader** in the bottom-right corner.

## How highlighting works

Every `Name: [line]` paragraph is spoken dialogue and is tinted with that character's color - label, brackets, and all - and the color stays the same for the whole chapter. A bracketed line without a name continues the previous speaker. A dashed, slanted block is a character's inner thoughts (the translation renders thoughts in italics). Plain text with no tint is narration. Lines labeled `???` keep a shared "unknown speaker" look instead of guessing. Name mentions inside narration get the same color as the speaker's dialogue.

## Read aloud (a play, not a robot)

Open **Read aloud** in the panel and press **▶ Read from top**, or just **click any line** to start reading from there. Text is read sentence by sentence with natural pauses, skipping credits and scene-break glyphs.

- **A voice per character**: dialogue is spoken with that character's own voice, kept for every chapter and session. Inner thoughts are read by the chapter's point-of-view character (its most frequent speaker). Narration uses the narrator voice, and `???` lines get a slightly lowered, unattributed read.
- **Voices are auto-cast to match the cast**: the extension knows the recurring Re:Zero characters (Subaru, Emilia, the twins, Beatrice, Anastasia, Julius, and many more) and picks distinct, gender-matched, natural-sounding device voices — preferring "Natural/Premium/Google" voices over robotic ones and never using novelty voices. Unknown names still get a distinct voice. Re-cast anytime with **✨ Auto-pick**, or choose any voice manually per character; your picks persist.
- **Speed** slider (0.5–2×) applies live. Uncheck "Give each character their own voice" for a single-voice reading that announces `Name:` labels instead.
- While reading, the current line is highlighted and followed; a small player pill offers pause/stop and shows who is speaking.

## Local AI character voices (the good ones)

The Device-voices engine is free and instant but robotic. The **Local AI server** engine reads the novel with AI voices generated on your own desktop — no cloud, no API key, no cost — and can genuinely sound like the Re:Zero cast. It works with two free, open-source engines that already have Re:Zero character voices available:

- **GPT-SoVITS** (recommended) — a voice is defined by a short clip of a character (5–10 seconds of Rem, Subaru, etc.) plus what that clip says. It reads your English text in that character's voice. No per-character training needed: any clean clip works, so grabbing lines from the anime is enough. Runs comfortably on a 6–8 GB GPU (an RTX 3050 is fine).
- **Style-Bert-VITS2** — per-character model files you download; lighter (~2 GB VRAM). "Load character models" in the panel auto-matches downloaded model names to the chapter's cast.

### One-time setup on the desktop (Windows, NVIDIA GPU)

1. Install **GPT-SoVITS** — easiest is the official Windows integrated package from the GitHub releases page (`RVC-Boss/GPT-SoVITS`). Unzip it somewhere like `C:\GPT-SoVITS`.
2. Collect one short, clean, dialogue-only clip per character (WAV, 5–10 s, no music/effects). Name them `rem.wav`, `subaru.wav`, … in e.g. `C:\voices`, and note what each clip says (the transcript must match the audio).
3. Start its API server from the package's folder:
   `python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml`
   (the integrated package includes a `go-api.bat`/API toggle that does the same). First launch loads the default model — about 4 GB of VRAM; it stays on the GPU between lines.
4. In the reader panel: **Voice engine → Local AI server**, address `http://127.0.0.1:9880`, type **GPT-SoVITS (api_v2)**. Press **Cast template**, edit the paths/prompts to match your clips (or start from `local-voices-template.json` shipped next to this README), then **Apply presets**. Press **Test** — "Server reachable" means you're done.
5. Click any line — the novel is now read as a radio play, each character in their own voice. Speed works via the slider (server-side, no pitch artifacts).

Notes: the extension talks to the server only on `127.0.0.1`/`localhost`, routed through the extension's own background worker (the site itself cannot reach your server). All text and audio stay on your machine. If the desktop sleeps mid-read, press Stop, wake it, press Read again. For Style-Bert-VITS2 instead: run `python server.py --api` (default `http://127.0.0.1:5000`), set server type accordingly, and use **Load character models** to auto-fill the cast; presets use `{model, style}` instead of `{ref, prompt, lang}`.

VRAM guidance: GPT-SoVITS v2 default config ~4 GB (fits the 3050 with headroom); v3/v4 sound better but want 6–8 GB — close other GPU apps or stay on v2. Style-Bert-VITS2 ~2 GB. With CPU-only fallback it still runs but each sentence takes seconds — the GPU is what makes it flow.

## Controls

- **Color dialogue by character** turns the tinting above on/off.
- **Theme** (warm paper / night / light), **text size**, and **column width** restyle the chapter immediately.
- **Calm reading mode** additionally hides the site's menus, sidebar, and comments and themes the whole page.
- Click a speaker in "Speakers in this chapter" to jump to their next line.
- **Where you were is saved automatically** as you scroll (on chapter pages). Reopen that chapter and it jumps straight back to your spot, with a short "Resumed at N%" note. The **Resume** button goes back to it, and **Save position** bookmarks explicitly.
- **The arc and chapter you were reading are remembered**: open the reader panel anywhere and the top of it shows your last chapter, its title, and how far you got — click it to jump back in. On any other page of the site (home, arc index, another chapter) a "Continue reading" card in the bottom-left corner does the same, dismissable with the ×.
- Everything is stored only in this browser on this site.

Speaker detection uses only the open page and does not infer secret identities or connect aliases. Expanding the speaker list can reveal names appearing later in the current chapter. Unknown speakers remain unknown. A shared color does not imply a relationship.

Settings and positions are stored in this site's local browser storage. They are accessible to scripts on that site, do not sync between browsers, and disappear if you clear site data. The extension requests no privileged permissions and runs only on witchculttranslation.com. It does not fetch biographies or send data anywhere.

To delete saved data, open the site's DevTools console and run `localStorage.removeItem('wcr:v2')` (and `localStorage.removeItem('wcr:v1')` for data saved by version 1.0), then refresh. Turn off calm reading mode to restore the normal site layout; to remove all visual changes, disable the extension and refresh.

Unpacked extensions are installed locally; this is not a Chrome Web Store listing. Source code is included. Site redesigns may require updating the content selector; saved positions use paragraph indices and may shift if a chapter is revised.
