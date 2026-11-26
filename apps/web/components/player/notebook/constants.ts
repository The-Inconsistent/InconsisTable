/** The notebook's views, in the order the switch shows them (#218). */
export const NOTEBOOK_VIEWS = ["inbox", "mission", "archive"] as const;
export type NotebookView = (typeof NOTEBOOK_VIEWS)[number];
