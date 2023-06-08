Feature: Prairie JSON Explorer

Background: On the prairie-json-explorer page

Scenario: Display the list of links from JSON files

On the prairie-json-explorer page
wait for _hai-json-files
in _hai-json-files, see latest-pr.json
in _hai-json-files, see review-1.json
in _hai-json-files, see review-2.json

Scenario: Display a message when there are no PR or review files

On the prairie-json-explorer page
wait for _hai-json-files
in _hai-json-files, see 'No PR or review files found.'

Scenario: Accessibility tests

On the prairie-json-explorer page
page is accessible accepting serious 0 and moderate 0