type ChunkOptions = {
  chunkSize: number;
  overlap: number;
};

export function chunkDocument(content: string, options: ChunkOptions): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  const step = Math.max(1, options.chunkSize - options.overlap);

  for (let index = 0; index < words.length; index += step) {
    const slice = words.slice(index, index + options.chunkSize);

    if (slice.length === 0) {
      continue;
    }

    chunks.push(slice.join(' '));

    if (index + options.chunkSize >= words.length) {
      break;
    }
  }

  return chunks;
}
