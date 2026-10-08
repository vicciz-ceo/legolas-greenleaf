"""Account for both reference libraries, including every retained file.

Unknown files belong to the character library, so new files cannot silently
escape accounting. Shared inventory tooling/reports count against both caps;
the combined total counts each file once. Disposable Python caches are omitted.
"""
from pathlib import Path

SCENE_DIRECTORIES = {'scenes', 'materials', 'vfx', 'props', 'ui', 'key-art'}
SCENE_ROOT_FILES = {'INDEX-scenes-graphics.md', 'QUALITY_REPORT-scenes.md'}
SCENE_TOOLS = {
    'README-scenes.md', 'scene_composition.py', 'compose_scenes.py',
    'compose_effects_props.py', 'qa_sheet.py', 'render_ui.mjs', 'validate_refs.py',
    'current-presets-scenes.json', 'generation-requests-scenes.json',
    'scene-production.jsonl', 'validation-scenes.json', 'visual-review-scenes.json',
}
SHARED_FILES = {'tools/reference_inventory.py', 'tools/test_reference_inventory.py',
                'reference-inventory.json', 'REFERENCE_LIBRARIES.md', 'tools/.gitignore'}

def retained_files(root):
    return sorted(p for p in Path(root).rglob('*') if p.is_file()
                  and '__pycache__' not in p.parts and p.suffix != '.pyc')

def owner(relative):
    path = Path(relative)
    if path.as_posix() in SHARED_FILES:
        return 'shared'
    if (path.parts[0] in SCENE_DIRECTORIES or path.as_posix() in SCENE_ROOT_FILES
            or (len(path.parts) == 2 and path.parts[0] == 'tools'
                and path.name in SCENE_TOOLS)):
        return 'scenes'
    return 'characters'

def library_files(root, library):
    if library not in ('characters', 'scenes'):
        raise ValueError('Unknown reference library')
    root = Path(root)
    return [p for p in retained_files(root) if owner(p.relative_to(root)) in (library, 'shared')]

def library_bytes(root, library):
    return sum(p.stat().st_size for p in library_files(root, library))

def inventory(root):
    root = Path(root)
    groups = {key: {'bytes': 0, 'files': []} for key in ('characters', 'scenes', 'shared')}
    for path in retained_files(root):
        relative = path.relative_to(root).as_posix()
        group = groups[owner(relative)]
        group['bytes'] += path.stat().st_size
        group['files'].append(relative)
    return {'ownership': groups,
            'combined_bytes': sum(g['bytes'] for g in groups.values()),
            'file_count': sum(len(g['files']) for g in groups.values()),
            'character_library_bytes': groups['characters']['bytes'] + groups['shared']['bytes'],
            'character_limit_bytes': 70_000_000,
            'scene_library_bytes': groups['scenes']['bytes'] + groups['shared']['bytes'],
            'scene_limit_bytes': 120_000_000,
            'shared_accounting': 'Shared files count against both caps; combined bytes count each retained file once.'}
