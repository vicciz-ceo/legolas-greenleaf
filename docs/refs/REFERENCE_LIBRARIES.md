# Integrated reference libraries

The character and scene/graphics libraries were authored independently and now coexist under docs/refs. Their composition rules remain separate: `tools/compose.py` preserves character #7f7f7f canvases and JPEG 4:4:4, while `tools/scene_composition.py` preserves scene colours and JPEG chroma subsampling.

- [Character library](README.md): 32 character sets and four supplements; existing 70,000,000-byte library and 2,500,000-byte per-set caps.
- [Scene/graphics library](INDEX-scenes-graphics.md): scenes, materials, VFX, props, UI and key art; existing 120,000,000-byte cap.
- [Complete inventory](reference-inventory.json): every retained file, explicit ownership, both budget totals and the combined size. Shared accounting files count against both caps; the combined size counts every file once. Unknown files are charged to the character library, so nothing silently escapes accounting. Disposable Python bytecode remains excluded as before.

Run `python docs/refs/tools/compose.py check --all` and `python docs/refs/tools/validate_refs.py` to validate both libraries. The merged inventory adds no new assets and removes none of either library's reconstruction sources.
