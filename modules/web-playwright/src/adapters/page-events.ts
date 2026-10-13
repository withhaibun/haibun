/** A page's traffic as its observer reads it: each request, each response with how long its exchange took, and each navigation of the page's main frame. */
import type { Frame, Page, Request, Response } from "playwright";
import type { TPageObserver, TPageRequest } from "../ports.js";

/** A request as its observer reads it. */
function requestOf(request: Request, page: Page): TPageRequest {
	const postData = request.postData();
	return {
		url: request.url(),
		method: request.method(),
		headers: request.headers(),
		...(postData === null ? {} : { postData }),
		frameUrl: request.frame().url(),
		pageUrl: page.url(),
	};
}

/** Sends `page`'s traffic to `observer` until the returned function is called. */
export function observePage(page: Page, observer: TPageObserver): () => void {
	const started = new Map<Request, number>();
	const onRequest = (request: Request) => {
		started.set(request, Date.now());
		observer.request(requestOf(request, page));
	};
	const onResponse = (response: Response) => {
		const request = response.request();
		const at = started.get(request);
		started.delete(request);
		const durationMs = at === undefined ? 0 : Date.now() - at;
		observer.response({ ...requestOf(request, page), url: response.url(), status: response.status(), statusText: response.statusText(), headers: response.headers(), durationMs });
	};
	const onFrameNavigated = (frame: Frame) => {
		if (frame === page.mainFrame()) observer.navigated(frame.url());
	};
	page.on("request", onRequest);
	page.on("response", onResponse);
	page.on("framenavigated", onFrameNavigated);
	return () => {
		page.off("request", onRequest);
		page.off("response", onResponse);
		page.off("framenavigated", onFrameNavigated);
	};
}
