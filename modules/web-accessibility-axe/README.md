# @haibun/web-accessibility-axe

This module checks the current page's accessibility with [axe-core](https://github.com/dequelabs/axe-core), Deque's
engine for the rules of the Web Content Accessibility Guidelines (WCAG). It uses the page that `@haibun/web-playwright`
holds.

`page is accessible accepting serious "0" and moderate "2"` checks the page and passes when it has at most that many
serious and moderate violations. A failure states the counts found and the counts accepted.

Where a storage stepper is defined, the step saves a report of the check as an HTML artifact. The report is a static
page: it holds no script and loads nothing. Each rule axe applied is a section that opens, the violations open first,
with the rule's impact, what it checks, a link to its guidance and each element it found. The report shows what the
checked page supplied as text.

The step also records the result of each rule that applies to the page in the graph, in the W3C Evaluation and Report
Language (EARL): an assertion that axe-core tested the page against the rule, linked to the result and to the step. A
result states its outcome (failed, can't tell, or passed), its impact, the elements it applies to and what fails there.
A rule that doesn't apply to the page is listed in the report and isn't recorded.
