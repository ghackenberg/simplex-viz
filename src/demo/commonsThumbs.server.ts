import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import type { CommonsThumbManifest, OptimizedThumbVariant } from './commonsThumbs';
import type { DemoDatasetId } from './data/multimodalCatalog';

const rawAssetModules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/commons/**/*.{jpg,jpeg,png,webp}',
  { eager: true },
);

/**
 * Generates exact-resolution WebP thumbnails through Astro's Sharp asset pipeline:
 * - Vega Cinema: 68×96 px (2x Retina for 33×47 CSS px canvas posters) & 128×192 px (inspector card)
 * - UCI Zoo:     58×58 px (2x Retina for ~27×27 CSS px medallions)    &  96×96 px (inspector card)
 */
export async function buildCommonsThumbManifest(
  datasets?: readonly DemoDatasetId[],
): Promise<CommonsThumbManifest> {
  const includeCinema = !datasets || datasets.includes('media');
  const includeZoo = !datasets || datasets.includes('zoo-species');

  if (!includeCinema && !includeZoo) {
    return {};
  }

  const entries = Object.entries(rawAssetModules);
  const resolvedPairs = await Promise.all(
    entries.map(async ([assetPath, mod]): Promise<readonly [string, OptimizedThumbVariant] | null> => {
      const localKey = assetPath.replace(/^\/src\/assets/, '');
      const isCinema = localKey.startsWith('/commons/cinema/');
      const isZoo = localKey.startsWith('/commons/zoo/');

      if (isCinema && !includeCinema) return null;
      if (isZoo && !includeZoo) return null;
      if (!isCinema && !isZoo) return null;

      if (isCinema) {
        const [canvasImg, inspectorImg] = await Promise.all([
          getImage({
            src: mod.default,
            width: 68,
            height: 96,
            fit: 'cover',
            format: 'webp',
            quality: 78,
          }),
          getImage({
            src: mod.default,
            width: 128,
            height: 192,
            fit: 'cover',
            format: 'webp',
            quality: 82,
          }),
        ]);
        return [
          localKey,
          {
            canvasSrc: canvasImg.src,
            inspectorSrc: inspectorImg.src,
          },
        ] as const;
      }

      const [canvasImg, inspectorImg] = await Promise.all([
        getImage({
          src: mod.default,
          width: 58,
          height: 58,
          fit: 'cover',
          format: 'webp',
          quality: 76,
        }),
        getImage({
          src: mod.default,
          width: 96,
          height: 96,
          fit: 'cover',
          format: 'webp',
          quality: 82,
        }),
      ]);
      return [
        localKey,
        {
          canvasSrc: canvasImg.src,
          inspectorSrc: inspectorImg.src,
        },
      ] as const;
    }),
  );

  const manifest: Record<string, OptimizedThumbVariant> = {};
  for (const pair of resolvedPairs) {
    if (pair) {
      manifest[pair[0]] = pair[1];
    }
  }
  return manifest;
}
