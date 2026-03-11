import { createHtmlReport } from "axe-html-reporter";

export function generateHTMLAxeReportFromBrowserResult(axeReport: object) {
    return createHtmlReport({
        results: axeReport,
        options: {
            doNotCreateReportFile: true
        },
    });
}
