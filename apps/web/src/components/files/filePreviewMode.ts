import { isAbsolutePath } from "~/terminal-links";

export const isMarkdownPreviewFile = (path: string): boolean => /\.(?:md|mdx)$/i.test(path);

export function shouldShowFileExplorer(input: {
  readonly relativePath: string | null;
  readonly explorerOpen: boolean;
  readonly attachmentOpen: boolean;
}): boolean {
  if (input.attachmentOpen || (input.relativePath && isAbsolutePath(input.relativePath))) {
    return false;
  }
  return input.explorerOpen || input.relativePath === null;
}

/** Whether a workspace path names a directory in the listed entries, with or without a trailing slash. */
export function isDirectoryEntry(
  entries:
    | ReadonlyArray<{ readonly kind: "file" | "directory"; readonly path: string }>
    | undefined,
  relativePath: string,
): boolean {
  const normalizedPath = relativePath.replace(/\/+$/, "");
  return (
    entries?.some((entry) => entry.kind === "directory" && entry.path === normalizedPath) ?? false
  );
}

export function setMarkdownTaskChecked(
  markdown: string,
  markerOffset: number,
  checked: boolean,
): string {
  if (
    markerOffset < 0 ||
    markdown[markerOffset] !== "[" ||
    !/[ xX]/.test(markdown[markerOffset + 1] ?? "") ||
    markdown[markerOffset + 2] !== "]"
  ) {
    return markdown;
  }

  return `${markdown.slice(0, markerOffset + 1)}${checked ? "x" : " "}${markdown.slice(markerOffset + 2)}`;
}
