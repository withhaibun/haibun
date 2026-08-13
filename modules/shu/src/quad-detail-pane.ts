/**
 * Shared seqPath utilities. A typed-fact subject IS its origin seqPath, so
 * click-throughs from the graph view and the step-detail pane route to
 * <shu-step-detail> via PaneState. `parseSeqPath` is bracket-tolerant, since
 * consumers feed it display strings like `"[0.1.2]"`.
 */

