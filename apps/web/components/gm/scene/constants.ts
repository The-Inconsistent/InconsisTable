import type { PrepKind } from "@inconsistable/core-schema";

// The two layers of the SCENE tab: the scene as a page, and the tracker (`?tab=track` opens the second).
export const SCENE_LAYERS = ["scene", "fight"] as const;
export type SceneLayer = (typeof SCENE_LAYERS)[number];

/** The prepared lines the page itself sends; exits are the footer's and the roster is the side panel's. */
export const PAGE_LINE_KINDS = ["reveals", "picks", "tests", "pools"] as const satisfies readonly PrepKind[];
