/**
 * The entry of the page's bundle. It defines the page's elements, each by importing its module, installs the page's ports
 * through the root, opens the page, and mounts `<shu-page>` in the served document's main element. The entry is outside the
 * module's kind positions, since it composes the views with the root (code-pattern CA4S2).
 */
import "./page-hydration.js";
import "../src/page/components/shu-page.js";
import "../src/page/components/shu-permissions.js";
import "../src/page/components/shu-page-key.js";
import "../src/page/components/shu-graph-query.js";
import "../src/page/components/shu-result-table.js";
import "../src/page/components/shu-column-pane.js";
import "../src/page/components/shu-column-strip.js";
import "../src/page/components/shu-entity-column.js";
import "../src/page/components/shu-filter-column.js";
import "../src/page/components/shu-actions-bar.js";
import "../src/page/components/shu-page-strip.js";
import "../src/page/ask/components/shu-ask.js";
import "../src/page/components/shu-breadcrumb.js";
import "../src/page/components/shu-combobox.js";
import "../src/page/components/shu-spinner.js";
import "../src/page/components/shu-step-caller.js";
import "../src/page/components/shu-monitor-column.js";
import "../src/page/components/shu-thread-column.js";
import "../src/page/components/shu-step-detail.js";
import "../src/page/components/shu-index-summary.js";
import "../src/page/components/shu-playback.js";
import "../src/page/components/shu-document-column.js";
import "../src/page/client-cache/components/shu-client-cache-column.js";
import "../src/page/components/shu-product-view.js";
import "../src/page/components/shu-views-picker.js";
import "../src/page/components/shu-affordances-panel.js";
import "../src/page/components/shu-domain-chain-view.js";
import "../src/components/shu-graph.js";
import "../src/page/components/shu-copy-button.js";
import "../src/page/components/shu-ref-element.js";
import "../src/page/components/shu-type-column.js";
import "../src/page/components/shu-step-definition.js";
import "../src/page/components/shu-action-column.js";
import "../src/page/components/shu-theme-switch.js";
import { readAction } from "@haibun/core/lib/actions.js";
import { Access } from "@haibun/core/lib/resources.js";
import { SSE_ROUTE } from "@haibun/core/lib/rpc-wire.js";
import { DELEGATIONS_READ_METHOD, type TDelegations } from "@haibun/core/lib/authority-types.js";
import { SHU_TAG } from "../src/domains/elements.js";
import { embeddedPageView, givenDelegation, pageAuthorityPort, pageClock, pageEmbedder, pageEventStream, pageObservers, startPage } from "../src/page/root.js";
import { authorityPort, openPageAuthority, pageMay } from "../src/page/authority/controllers/page-authority-controller.js";
import { conduit } from "../src/page/controllers/conduit-controller.js";
import { getHash, pushHash } from "../src/page/controllers/hash-controller.js";
import { pageBlipChannel } from "../src/page/controllers/blip-controller.js";
import { hashFromQuery, hashWithColumns } from "../src/page/derivations/address.js";
import { reads } from "../src/page/domains/links.js";
import { askEmbedderToDelegate, receiveFromEmbedder, type TEmbedding } from "../src/page/pipelines/embedding.js";
import { openPage } from "../src/page/pipelines/open-page.js";
import { recordLongFrames, reportRefusedScripts } from "../src/page/pipelines/page-observations.js";
import { installShuTokens } from "../src/page/components/styles.js";
import { applyStoredTheme } from "../src/page/components/shu-theme-switch.js";
import type { ShuPage } from "../src/page/components/shu-page.js";
import {
	deploymentAllowedWithoutDelegation,
	deploymentEmbedderOrigin,
	deploymentVerifiesDelegations,
	getHydratedViewHash,
	hydratedCache,
	pageBuild,
	responseTimeoutMs,
} from "../src/page/controllers/hydration-controller.js";
import { getAvailableSteps, requiredActionOf } from "../src/page/controllers/registry-controller.js";
import { hydrateClientCache } from "../src/page/client-cache/controllers/device-controller.js";
import { viewsShown } from "../src/page/client-cache/controllers/run-controller.js";
import { followRunningTurns } from "../src/page/ask/controllers/conversation-controller.js";

/** The id of the served document's main element, which holds the page. */
const MAIN_ID = "shu-main";
/** The attribute of the main element that states the path the site serves its routes under. */
const API_BASE_ATTRIBUTE = "data-api-base";

async function start(): Promise<void> {
	// Whether the reader arrived at an address that names views, read before anything writes the hash. An address that names
	// views is the reader's own arrangement; a reader whose address doesn't name one is shown actuality's views.
	const arrivedWithAddress = getHash().length > 1;
	const carried = hydratedCache();
	startPage(authorityPort(), requiredActionOf, SSE_ROUTE);
	// The page that embeds shu at the deployment's embedder origin posts the page the reader has open and a delegation to
	// shu's key.
	const embedder = carried === undefined && window.parent !== window ? deploymentEmbedderOrigin() : undefined;
	const embedding: TEmbedding | undefined =
		embedder === undefined
			? undefined
			: { channel: pageEmbedder(embedder), pageView: embeddedPageView, given: givenDelegation, authority: pageAuthorityPort(), clock: pageClock() };
	if (embedding !== undefined) receiveFromEmbedder(embedding);
	// The long frames of the page's main thread, from its start, including the frames before this call.
	recordLongFrames(pageObservers(), pageBlipChannel);
	// The design tokens are installed at the document, so an element rendered into the document's body reads the variables a
	// view's shadow root inherits.
	installShuTokens();
	applyStoredTheme();
	const seeded = hashFromQuery(location.search);
	if (getHash().length <= 2 && seeded !== undefined) pushHash(seeded);
	// A page that carries a record of actuality writes it into the client cache before anything reads actuality.
	if (carried !== undefined) {
		await hydrateClientCache(carried);
		const opensAt = getHydratedViewHash();
		if (opensAt !== undefined) pushHash(opensAt);
	}
	const opening = await openPage({
		carried: carried !== undefined,
		arrivedWithAddress,
		openAuthority: () =>
			openPageAuthority(
				deploymentVerifiesDelegations() ? () => conduit().follow<TDelegations>(reads(DELEGATIONS_READ_METHOD), "read what was delegated to this page") : undefined,
				deploymentAllowedWithoutDelegation(),
			),
		mayRead: () => pageMay(readAction(Access.public)),
		delegateFromEmbedder:
			embedding !== undefined && carried === undefined && deploymentVerifiesDelegations()
				? (controller) => askEmbedderToDelegate(embedding, controller, responseTimeoutMs())
				: undefined,
		readSteps: getAvailableSteps,
		connect: () => pageEventStream().connect(),
		followTurns: () => {
			followRunningTurns();
		},
		viewsShown,
		pageBuild,
	});
	if (opening.status === "opened") {
		// A reader without an arrangement is shown actuality's views, or the hash the site served the page to open at.
		if (opening.shown.length > 0) pushHash(hashWithColumns(opening.shown));
		else if (!arrivedWithAddress && carried === undefined) {
			const servedAt = getHydratedViewHash();
			if (servedAt !== undefined) pushHash(servedAt);
		}
	}
	const main = document.getElementById(MAIN_ID);
	if (main === null) throw new Error(`the served document doesn't hold its main element, #${MAIN_ID}`);
	const apiBase = main.getAttribute(API_BASE_ATTRIBUTE);
	if (apiBase === null) throw new Error(`the served document's main element doesn't state ${API_BASE_ATTRIBUTE}`);
	const page = document.createElement(SHU_TAG.PAGE) as ShuPage;
	page.opening = opening;
	page.apiBase = apiBase;
	main.replaceChildren(page);
}

reportRefusedScripts(pageObservers());
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
else void start();
