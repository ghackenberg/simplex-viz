export interface OptimizedThumbVariant {
  readonly canvasSrc: string;
  readonly inspectorSrc: string;
}

export type CommonsThumbManifest = Readonly<Record<string, OptimizedThumbVariant>>;
