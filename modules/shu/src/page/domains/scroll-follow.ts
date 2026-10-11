/** The live edge of a followed view, as every scrolling view and the controls that assert it state it. */

/** How many pixels above its end a followed view may sit and still count as at the live edge: the height-estimate
 *  overshoot below the last row is tens of pixels, a stalled follow is hundreds. One contract, shared by every host
 *  that reports its end and by the control that asserts it. */
export const FOLLOW_EDGE_SLACK_PX = 200;
