/**
 * Manifest seluruh aset gambar. BootScene memuat path ini satu per satu;
 * jika file PNG belum ada, placeholder geometri dibuat otomatis dengan key yang sama.
 */
export type AssetKind = 'character' | 'weapon' | 'map' | 'ui' | 'effect';

export interface AssetDefinition {
  key: string;
  path: string;
  kind: AssetKind;
  color: string;
  width: number;
  height: number;
}

const path = (folder: string, file: string): string => `assets/${folder}/${file}`;

export const ASSET_MANIFEST: AssetDefinition[] = [
  {
    key: 'char_bocil_sarung',
    path: path('characters', 'bocil_sarung.png'),
    kind: 'character',
    color: '#f6c28b',
    width: 48,
    height: 56,
  },
  {
    key: 'char_abang_ronda',
    path: path('characters', 'abang_ronda.png'),
    kind: 'character',
    color: '#8d6e63',
    width: 48,
    height: 56,
  },
  {
    key: 'char_tukang_lodong',
    path: path('characters', 'tukang_lodong.png'),
    kind: 'character',
    color: '#a1887f',
    width: 48,
    height: 56,
  },
  {
    key: 'weap_sarung_pecut',
    path: path('weapons', 'sarung_pecut.png'),
    kind: 'weapon',
    color: '#26a69a',
    width: 36,
    height: 36,
  },
  {
    key: 'weap_sandal_jepit',
    path: path('weapons', 'sandal_jepit.png'),
    kind: 'weapon',
    color: '#8d6e63',
    width: 36,
    height: 36,
  },
  {
    key: 'weap_petasan_banting',
    path: path('weapons', 'petasan_banting.png'),
    kind: 'weapon',
    color: '#ef5350',
    width: 36,
    height: 36,
  },
  {
    key: 'weap_mercon_sreng',
    path: path('weapons', 'mercon_sreng.png'),
    kind: 'weapon',
    color: '#ff7043',
    width: 36,
    height: 36,
  },
  {
    key: 'weap_meriam_bambu',
    path: path('weapons', 'meriam_bambu.png'),
    kind: 'weapon',
    color: '#66bb6a',
    width: 36,
    height: 36,
  },
  {
    key: 'map_tileset_kampung',
    path: path('maps', 'tileset_kampung.png'),
    kind: 'map',
    color: '#7cb342',
    width: 64,
    height: 64,
  },
  {
    key: 'map_pos_ronda',
    path: path('maps', 'pos_ronda.png'),
    kind: 'map',
    color: '#c98b52',
    width: 128,
    height: 128,
  },
  {
    key: 'fx_ledakan',
    path: path('effects', 'efek_ledakan.png'),
    kind: 'effect',
    color: '#ff7043',
    width: 128,
    height: 128,
  },
  {
    key: 'ui_icon_koin_thr',
    path: path('ui', 'icon_koin_thr.png'),
    kind: 'ui',
    color: '#ffca28',
    width: 32,
    height: 32,
  },
  {
    key: 'ui_logo',
    path: path('ui', 'logo.png'),
    kind: 'ui',
    color: '#ef5350',
    width: 320,
    height: 112,
  },
];

export const ASSETS_BY_KEY: Record<string, AssetDefinition> = Object.fromEntries(
  ASSET_MANIFEST.map((asset) => [asset.key, asset]),
);
