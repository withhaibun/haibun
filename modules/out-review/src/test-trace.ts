import { THistoryWithMeta } from "./out-reviews-stepper.js";

export const historyWithMeta: THistoryWithMeta = {
  "meta": {
    "startTime": "2023-10-06T11:53:17.597Z",
    "title": "local a11y",
    "startOffset": 0.791768677,
    ok: true,
  },
  "logHistory": [
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "features: 2 backgrounds: 7 steps: (/features/a11y-fail.feature,/features/a11y-pass.feature), 2",
      "level": "log",
      "caller": "run:67:18"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "███ feature 1: /features/a11y-fail.feature",
      "level": "log",
      "caller": "Executor:88:18"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Feature: Test accessibility\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 0,
          "result": {
            "ok": true,
            "in": "Feature: Test accessibility",
            "sourcePath": "/features/a11y-fail.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "feature",
                "start": 0.299280259,
                "end": 0.299323789
              }
            ],
            "seq": 1
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Set test to http://localhost:8123/a11y.html\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 1,
          "result": {
            "ok": true,
            "in": "Set test to http://localhost:8123/a11y.html",
            "sourcePath": "/backgrounds/int/a11y.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "set",
                "start": 0.299696448,
                "end": 0.299733388
              }
            ],
            "seq": 2
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Serve files from \"a11y\"\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "serving files from /home/vid/D/withhaibun/haibun-e2e-tests/files/a11y at /",
      "level": "info",
      "caller": "server-express:111:17"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Server listening on port: 8123",
      "level": "log",
      "caller": "server-express:39:25"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "express listening",
      "level": "log",
      "caller": "server-express:41:25"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 2,
          "result": {
            "ok": true,
            "in": "Serve files from \"a11y\"",
            "sourcePath": "/features/a11y-fail.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "serveFiles",
                "start": 0.300125808,
                "end": 0.303827874
              }
            ],
            "seq": 3
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Go to the test webpage\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "creating new page for 0",
      "level": "info",
      "caller": "BrowserFactory:137:17"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "creating new context 0 chromium",
      "level": "info",
      "caller": "BrowserFactory:84:21"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "launched new chromium browser",
      "level": "info",
      "caller": "BrowserFactory:66:19"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 3,
          "result": {
            "ok": true,
            "in": "Go to the test webpage",
            "sourcePath": "/features/a11y-fail.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "gotoPage",
                "start": 0.304186624,
                "end": 0.547705541
              }
            ],
            "seq": 4
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "page is accessible accepting serious 0 and moderate 0\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "artifact": {
          "type": "html",
          "content": "<!DOCTYPE html>\n<html lang=\"en\">\n    <head>\n        <!-- Required meta tags -->\n        <meta charset=\"utf-8\" />\n        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\" />\n        <style>\n            .violationCard {\n                width: 100%;\n                margin-bottom: 1rem;\n            }\n            .violationCardLine {\n                display: flex;\n                justify-content: space-between;\n                align-items: start;\n            }\n            .learnMore {\n                margin-bottom: 0.75rem;\n                white-space: nowrap;\n                color: #2557a7;\n            }\n            .card-link {\n                color: #2557a7;\n            }\n            .violationNode {\n                font-size: 0.75rem;\n            }\n            .wrapBreakWord {\n                word-break: break-word;\n            }\n            .summary {\n                font-size: 1rem;\n            }\n            .summarySection {\n                margin: 0.5rem 0;\n            }\n            .hljs {\n                white-space: pre-wrap;\n                width: 100%;\n                background: #f0f0f0;\n            }\n            p {\n                margin-top: 0.3rem;\n            }\n            li {\n                line-height: 1.618;\n            }\n        </style>\n        <!-- Bootstrap CSS -->\n        <link\n            rel=\"stylesheet\"\n            href=\"https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css\"\n            integrity=\"sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z\"\n            crossorigin=\"anonymous\"\n        />\n        <script\n            src=\"https://code.jquery.com/jquery-3.2.1.slim.min.js\"\n            integrity=\"sha384-KJ3o2DKtIkvYIK3UENzmM7KCkRr/rE9/Qpg6aAZGJwFDMVNA/GpGFF93hXpG5KkN\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <script\n            src=\"https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js\"\n            integrity=\"sha384-ApNbgh9B+Y1QKtv3Rn7W3mgPxhU9K/ScQsAP7hUibX39j7fakFPskvXusvfa0b4Q\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <script\n            src=\"https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/js/bootstrap.min.js\"\n            integrity=\"sha384-JZR6Spejh4U02d8jOt6vLEHfe/JQGiRRSQQxSfFWpi1MquVdAyjUar5+76PVCmYl\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <link\n            rel=\"stylesheet\"\n            href=\"//cdnjs.cloudflare.com/ajax/libs/highlight.js/10.5.0/styles/stackoverflow-light.min.css\"\n        />\n        <script src=\"//cdnjs.cloudflare.com/ajax/libs/highlight.js/10.5.0/highlight.min.js\"></script>\n        <link\n            rel=\"icon\"\n            href=\"https://www.deque.com/wp-content/uploads/2018/03/cropped-DQ_SecondaryLogo_HeroBlue_RGB-1-32x32.png\"\n            sizes=\"32x32\"\n        />\n        <title>AXE Accessibility Results</title>\n    </head>\n    <body>\n        <div style=\"padding: 2rem\">\n            <h3>\n                AXE Accessibility Results\n            </h3>\n            <div class=\"summarySection\">\n                <div class=\"summary\">\n                    Page URL:\n                    <a href=\"http:&#x2F;&#x2F;localhost:8123&#x2F;a11y.html\" target=\"_blank\" class=\"card-link\">http:&#x2F;&#x2F;localhost:8123&#x2F;a11y.html</a>\n                    <br />\n                </div>\n            </div>\n            <h5>axe-core found <span class=\"badge badge-warning\">7</span> violations</h5>\n            <table class=\"table table-striped table-bordered\">\n                <thead>\n                    <tr>\n                        <th style=\"width: 5%\">#</th>\n                        <th style=\"width: 45%\">Description</th>\n                        <th style=\"width: 15%\">Axe rule ID</th>\n                        <th style=\"width: 23%\">WCAG</th>\n                        <th style=\"width: 7%\">Impact</th>\n                        <th style=\"width: 5%\">Count</th>\n                    </tr>\n                </thead>\n                <tbody>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#1\" class=\"card-link\">1</a></th>\n                        <td>Documents must have &lt;title&gt; element to aid in navigation</td>\n                        <td>document-title</td>\n                        <td>WCAG 2 Level A, WCAG 2.4.2</td>\n                        <td>serious</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#2\" class=\"card-link\">2</a></th>\n                        <td>&lt;html&gt; element must have a lang attribute</td>\n                        <td>html-has-lang</td>\n                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                        <td>serious</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#3\" class=\"card-link\">3</a></th>\n                        <td>Form elements must have labels</td>\n                        <td>label</td>\n                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                        <td>critical</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#4\" class=\"card-link\">4</a></th>\n                        <td>Document should have one main landmark</td>\n                        <td>landmark-one-main</td>\n                        <td>Best practice</td>\n                        <td>moderate</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#5\" class=\"card-link\">5</a></th>\n                        <td>All page content should be contained by landmarks</td>\n                        <td>region</td>\n                        <td>Best practice</td>\n                        <td>moderate</td>\n                        <td>3</td>\n                    </tr>\n                </tbody>\n            </table>\n            <h3>Failed</h3>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"1\">1.</a> Documents must have &lt;title&gt; element to aid in navigation\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;document-title?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">document-title</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 2.4.2\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures each HTML document contains a non-empty &lt;title&gt; element</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            serious\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.text-alternatives </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag242 </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Document does not have a non-empty &lt;title&gt; element</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"2\">2.</a> &lt;html&gt; element must have a lang attribute\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;html-has-lang?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">html-has-lang</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 3.1.1\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures every HTML document has a lang attribute</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            serious\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.language </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag311 </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  The &lt;html&gt; element does not have a lang attribute</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"3\">3.</a> Form elements must have labels\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;label?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">label</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 4.1.2\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures every form element has a label</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            critical\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.forms </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag412 </span>\n\n                            <span class=\"badge bg-light text-dark\"> section508 </span>\n\n                            <span class=\"badge bg-light text-dark\"> section508.22.n </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">#upload-chooser</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;input type&#x3D;&quot;file&quot; name&#x3D;&quot;upload&quot; id&#x3D;&quot;upload-chooser&quot; required&#x3D;&quot;required&quot;&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Form element does not have an implicit (wrapped) &lt;label&gt;</li>\n                                                <li>  Form element does not have an explicit &lt;label&gt;</li>\n                                                <li>  aria-label attribute does not exist or is empty</li>\n                                                <li>  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty</li>\n                                                <li>  Element has no title attribute</li>\n                                                <li>  Element has no placeholder attribute</li>\n                                                <li>  Element&#39;s default semantics were not overridden with role&#x3D;&quot;none&quot; or role&#x3D;&quot;presentation&quot;</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"4\">4.</a> Document should have one main landmark\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;landmark-one-main?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">landmark-one-main</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Best practice\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures the document has a main landmark</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            moderate\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.semantics </span>\n\n                            <span class=\"badge bg-light text-dark\"> best-practice </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix all of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Document does not have a main landmark</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"5\">5.</a> All page content should be contained by landmarks\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;region?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">region</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Best practice\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures all page content is contained by landmarks</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            moderate\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.keyboard </span>\n\n                            <span class=\"badge bg-light text-dark\"> best-practice </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">h1</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;h1&gt;Upload form&lt;&#x2F;h1&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                                <tr>\n                                    <td>2</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">label</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;label for&#x3D;&quot;upload&quot;&gt;upload&lt;&#x2F;label&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                                <tr>\n                                    <td>3</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">#upload-chooser</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;input type&#x3D;&quot;file&quot; name&#x3D;&quot;upload&quot; id&#x3D;&quot;upload-chooser&quot; required&#x3D;&quot;required&quot;&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionPasses\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingOne\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#passes\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"passes\"\n                            >\n                                axe returned 11 passed axe\n                                checks. Expand details on\n                                click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"passes\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingOne\"\n                        data-parent=\"#accordionPasses\"\n                    >\n                        <div class=\"card-body\">\n                            <table class=\"table table-bordered\">\n                                <thead>\n                                    <tr>\n                                        <th style=\"width: 5%\">#</th>\n                                        <th style=\"width: 40%\">Description</th>\n                                        <th style=\"width: 5%\">Axe rule ID</th>\n                                        <th style=\"width: 15%\">WCAG</th>\n                                        <th style=\"width: 5%\">Nodes passed check</th>\n                                    </tr>\n                                </thead>\n                                <tbody>\n                                    <tr>\n                                        <th scope=\"row\">1</th>\n                                        <td>aria-hidden&#x3D;&#39;true&#39; must not be present on the document body</td>\n                                        <td>aria-hidden-body</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">2</th>\n                                        <td>Buttons must have discernible text</td>\n                                        <td>button-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">3</th>\n                                        <td>Elements must have sufficient color contrast</td>\n                                        <td>color-contrast</td>\n                                        <td>WCAG 2 Level AA, WCAG 1.4.3</td>\n                                        <td>4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">4</th>\n                                        <td>IDs of active elements must be unique</td>\n                                        <td>duplicate-id-active</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                        <td>2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">5</th>\n                                        <td>Headings should not be empty</td>\n                                        <td>empty-heading</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">6</th>\n                                        <td>Form field must not have multiple label elements</td>\n                                        <td>form-field-multiple-labels</td>\n                                        <td>WCAG 2 Level A, WCAG 3.3.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">7</th>\n                                        <td>Heading levels should only increase by one</td>\n                                        <td>heading-order</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">8</th>\n                                        <td>Form elements should have a visible label</td>\n                                        <td>label-title-only</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">9</th>\n                                        <td>Interactive controls must not be nested</td>\n                                        <td>nested-interactive</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">10</th>\n                                        <td>Page should contain a level-one heading</td>\n                                        <td>page-has-heading-one</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">11</th>\n                                        <td>All page content should be contained by landmarks</td>\n                                        <td>region</td>\n                                        <td>Best practice</td>\n                                        <td>2</td>\n                                    </tr>\n                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionIncomplete\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingTwo\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#incomplete\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"incomplete\"\n                            >\n                                axe returned 0 incomplete checks. Expand\n                                details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"incomplete\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingTwo\"\n                        data-parent=\"#accordionIncomplete\"\n                    >\n                        <div class=\"card-body\">\n                            <p><em>What 'incomplete' axe checks means?</em></p>\n                            <p>\n                                Incomplete results were aborted and require further testing. This\n                                can happen either because of technical restrictions to what the rule\n                                can test, or because a javascript error occurred.\n                            </p>\n                            <p>\n                                <a\n                                    href=\"https://www.deque.com/axe/core-documentation/api-documentation/#results-object\"\n                                    >Visit axe API Documentation</a\n                                >\n                                to learn more.\n                            </p>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionInapplicable\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingThree\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#inapplicable\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"inapplicable\"\n                            >\n                                axe returned 72 inapplicable checks.\n                                Expand details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"inapplicable\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingThree\"\n                        data-parent=\"#accordionInapplicable\"\n                    >\n                        <div class=\"card-body\">\n                            <p><em>What 'inapplicable' axe checks means?</em></p>\n                            <p>\n                                The inapplicable array lists all the rules for which no matching\n                                elements were found on the page.\n                            </p>\n                            <p>\n                                <a\n                                    href=\"https://www.deque.com/axe/core-documentation/api-documentation/#results-object\"\n                                    >Visit axe API Documentation</a\n                                >\n                                to learn more.\n                            </p>\n                            <table class=\"table table-bordered\">\n                                <thead>\n                                    <tr>\n                                        <th style=\"width: 5%\">#</th>\n                                        <th style=\"width: 50%\">Description</th>\n                                        <th style=\"width: 20%\">Axe rule ID</th>\n                                        <th style=\"width: 15%\">WCAG</th>\n                                    </tr>\n                                </thead>\n                                <tbody>\n                                    <tr>\n                                        <th scope=\"row\">1</th>\n                                        <td>accesskey attribute value should be unique</td>\n                                        <td>accesskeys</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">2</th>\n                                        <td>Active &lt;area&gt; elements must have alternate text</td>\n                                        <td>area-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 2.4.4, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">3</th>\n                                        <td>Elements must only use allowed ARIA attributes</td>\n                                        <td>aria-allowed-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">4</th>\n                                        <td>ARIA role should be appropriate for the element</td>\n                                        <td>aria-allowed-role</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">5</th>\n                                        <td>ARIA commands must have an accessible name</td>\n                                        <td>aria-command-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">6</th>\n                                        <td>ARIA dialog and alertdialog nodes should have an accessible name</td>\n                                        <td>aria-dialog-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">7</th>\n                                        <td>ARIA hidden element must not be focusable or contain focusable elements</td>\n                                        <td>aria-hidden-focus</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">8</th>\n                                        <td>ARIA input fields must have an accessible name</td>\n                                        <td>aria-input-field-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">9</th>\n                                        <td>ARIA meter nodes must have an accessible name</td>\n                                        <td>aria-meter-name</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">10</th>\n                                        <td>ARIA progressbar nodes must have an accessible name</td>\n                                        <td>aria-progressbar-name</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">11</th>\n                                        <td>Required ARIA attributes must be provided</td>\n                                        <td>aria-required-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">12</th>\n                                        <td>Certain ARIA roles must contain particular children</td>\n                                        <td>aria-required-children</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">13</th>\n                                        <td>Certain ARIA roles must be contained by particular parents</td>\n                                        <td>aria-required-parent</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">14</th>\n                                        <td>aria-roledescription must be on elements with a semantic role</td>\n                                        <td>aria-roledescription</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">15</th>\n                                        <td>ARIA roles used must conform to valid values</td>\n                                        <td>aria-roles</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">16</th>\n                                        <td>&quot;role&#x3D;text&quot; should have no focusable descendants</td>\n                                        <td>aria-text</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">17</th>\n                                        <td>ARIA toggle fields must have an accessible name</td>\n                                        <td>aria-toggle-field-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">18</th>\n                                        <td>ARIA tooltip nodes must have an accessible name</td>\n                                        <td>aria-tooltip-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">19</th>\n                                        <td>ARIA treeitem nodes should have an accessible name</td>\n                                        <td>aria-treeitem-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">20</th>\n                                        <td>ARIA attributes must conform to valid values</td>\n                                        <td>aria-valid-attr-value</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">21</th>\n                                        <td>ARIA attributes must conform to valid names</td>\n                                        <td>aria-valid-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">22</th>\n                                        <td>autocomplete attribute must be used correctly</td>\n                                        <td>autocomplete-valid</td>\n                                        <td>WCAG 2.1 Level AA, WCAG 1.3.5</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">23</th>\n                                        <td>Inline text spacing must be adjustable with custom stylesheets</td>\n                                        <td>avoid-inline-spacing</td>\n                                        <td>WCAG 2.1 Level AA, WCAG 1.4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">24</th>\n                                        <td>&lt;blink&gt; elements are deprecated and must not be used</td>\n                                        <td>blink</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">25</th>\n                                        <td>Page must have means to bypass repeated blocks</td>\n                                        <td>bypass</td>\n                                        <td>WCAG 2 Level A, WCAG 2.4.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">26</th>\n                                        <td>&lt;dl&gt; elements must only directly contain properly-ordered &lt;dt&gt; and &lt;dd&gt; groups, &lt;script&gt;, &lt;template&gt; or &lt;div&gt; elements</td>\n                                        <td>definition-list</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">27</th>\n                                        <td>&lt;dt&gt; and &lt;dd&gt; elements must be contained by a &lt;dl&gt;</td>\n                                        <td>dlitem</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">28</th>\n                                        <td>IDs used in ARIA and labels must be unique</td>\n                                        <td>duplicate-id-aria</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">29</th>\n                                        <td>id attribute value must be unique</td>\n                                        <td>duplicate-id</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">30</th>\n                                        <td>Table header text should not be empty</td>\n                                        <td>empty-table-header</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">31</th>\n                                        <td>Frames with focusable content must not have tabindex&#x3D;-1</td>\n                                        <td>frame-focusable-content</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">32</th>\n                                        <td>Frames should be tested with axe-core</td>\n                                        <td>frame-tested</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">33</th>\n                                        <td>Frames must have a unique title attribute</td>\n                                        <td>frame-title-unique</td>\n                                        <td>WCAG 4.1.2, WCAG 2 Level A</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">34</th>\n                                        <td>Frames must have an accessible name</td>\n                                        <td>frame-title</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">35</th>\n                                        <td>&lt;html&gt; element must have a valid value for the lang attribute</td>\n                                        <td>html-lang-valid</td>\n                                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">36</th>\n                                        <td>HTML elements with lang and xml:lang must have the same base language</td>\n                                        <td>html-xml-lang-mismatch</td>\n                                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">37</th>\n                                        <td>Images must have alternate text</td>\n                                        <td>image-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">38</th>\n                                        <td>Alternative text of images should not be repeated as text</td>\n                                        <td>image-redundant-alt</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">39</th>\n                                        <td>Input buttons must have discernible text</td>\n                                        <td>input-button-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">40</th>\n                                        <td>Image buttons must have alternate text</td>\n                                        <td>input-image-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">41</th>\n                                        <td>Banner landmark should not be contained in another landmark</td>\n                                        <td>landmark-banner-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">42</th>\n                                        <td>Aside should not be contained in another landmark</td>\n                                        <td>landmark-complementary-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">43</th>\n                                        <td>Contentinfo landmark should not be contained in another landmark</td>\n                                        <td>landmark-contentinfo-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">44</th>\n                                        <td>Main landmark should not be contained in another landmark</td>\n                                        <td>landmark-main-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">45</th>\n                                        <td>Document should not have more than one banner landmark</td>\n                                        <td>landmark-no-duplicate-banner</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">46</th>\n                                        <td>Document should not have more than one contentinfo landmark</td>\n                                        <td>landmark-no-duplicate-contentinfo</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">47</th>\n                                        <td>Document should not have more than one main landmark</td>\n                                        <td>landmark-no-duplicate-main</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">48</th>\n                                        <td>Ensures landmarks are unique</td>\n                                        <td>landmark-unique</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">49</th>\n                                        <td>Links must be distinguishable without relying on color</td>\n                                        <td>link-in-text-block</td>\n                                        <td>WCAG 2 Level A, WCAG 1.4.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">50</th>\n                                        <td>Links must have discernible text</td>\n                                        <td>link-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2, WCAG 2.4.4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">51</th>\n                                        <td>&lt;ul&gt; and &lt;ol&gt; must only directly contain &lt;li&gt;, &lt;script&gt; or &lt;template&gt; elements</td>\n                                        <td>list</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">52</th>\n                                        <td>&lt;li&gt; elements must be contained in a &lt;ul&gt; or &lt;ol&gt;</td>\n                                        <td>listitem</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">53</th>\n                                        <td>&lt;marquee&gt; elements are deprecated and must not be used</td>\n                                        <td>marquee</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">54</th>\n                                        <td>Delayed refresh under 20 hours must not be used</td>\n                                        <td>meta-refresh</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">55</th>\n                                        <td>Users should be able to zoom and scale the text up to 500%</td>\n                                        <td>meta-viewport-large</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">56</th>\n                                        <td>Zooming and scaling must not be disabled</td>\n                                        <td>meta-viewport</td>\n                                        <td>WCAG 2 Level AA, WCAG 1.4.4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">57</th>\n                                        <td>&lt;object&gt; elements must have alternate text</td>\n                                        <td>object-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">58</th>\n                                        <td>Ensure elements marked as presentational are consistently ignored</td>\n                                        <td>presentation-role-conflict</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">59</th>\n                                        <td>[role&#x3D;&#39;img&#39;] elements must have an alternative text</td>\n                                        <td>role-img-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">60</th>\n                                        <td>scope attribute should be used correctly</td>\n                                        <td>scope-attr-valid</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">61</th>\n                                        <td>Scrollable region must have keyboard access</td>\n                                        <td>scrollable-region-focusable</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">62</th>\n                                        <td>Select element must have an accessible name</td>\n                                        <td>select-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">63</th>\n                                        <td>Server-side image maps must not be used</td>\n                                        <td>server-side-image-map</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">64</th>\n                                        <td>The skip-link target should exist and be focusable</td>\n                                        <td>skip-link</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">65</th>\n                                        <td>&lt;svg&gt; elements with an img role must have an alternative text</td>\n                                        <td>svg-img-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">66</th>\n                                        <td>Elements should not have tabindex greater than zero</td>\n                                        <td>tabindex</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">67</th>\n                                        <td>tables should not have the same summary and caption</td>\n                                        <td>table-duplicate-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">68</th>\n                                        <td>Table cells that use the headers attribute must only refer to cells in the same table</td>\n                                        <td>td-headers-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">69</th>\n                                        <td>Table headers in a data table must refer to data cells</td>\n                                        <td>th-has-data-cells</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">70</th>\n                                        <td>lang attribute must have a valid value</td>\n                                        <td>valid-lang</td>\n                                        <td>WCAG 2 Level AA, WCAG 3.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">71</th>\n                                        <td>&lt;video&gt; elements must have captions</td>\n                                        <td>video-caption</td>\n                                        <td>WCAG 2 Level A, WCAG 1.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">72</th>\n                                        <td>&lt;video&gt; or &lt;audio&gt; elements must not play automatically</td>\n                                        <td>no-autoplay-audio</td>\n                                        <td>WCAG 2 Level A, WCAG 1.4.2</td>\n                                    </tr>\n                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"rulesSection\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"ruleSection\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#rules\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"inapplicable\"\n                            >\n                                axe was running with 0 rules. Expand details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"rules\"\n                        class=\"collapse\"\n                        aria-labelledby=\"ruleSection\"\n                        data-parent=\"#rules\"\n                    >\n                        <div class=\"card-body\">\n                        </div>\n                    </div>\n                </div>\n            </div>\n        </div>\n\n        <script>\n            hljs.initHighlightingOnLoad();\n        </script>\n    </body>\n</html>\n",
          "event": "failure"
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "not acceptable",
      "level": "error",
      "caller": "a11y-axe-stepper:77:30"
    },
    {
      "messageContext": {
        "artifact": {
          "type": "picture",
          "path": "./capture/default/__test/loop-1/seq-0/featn-1/mem-0/failure/5.png",
          "event": "failure"
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "onFailure from page is accessible accepting serious 0 and moderate 0 for WebPlaywright",
      "level": "error",
      "caller": "Executor:146:27"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 4,
          "result": {
            "ok": false,
            "in": "page is accessible accepting serious 0 and moderate 0",
            "sourcePath": "/features/a11y-fail.feature",
            "actionResults": [
              {
                "ok": false,
                "message": "not acceptable",
                "topics": {
                  "axeFailure": {
                    "summary": "not acceptable",
                    "report": {
                      "html": "<!DOCTYPE html>\n<html lang=\"en\">\n    <head>\n        <!-- Required meta tags -->\n        <meta charset=\"utf-8\" />\n        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, shrink-to-fit=no\" />\n        <style>\n            .violationCard {\n                width: 100%;\n                margin-bottom: 1rem;\n            }\n            .violationCardLine {\n                display: flex;\n                justify-content: space-between;\n                align-items: start;\n            }\n            .learnMore {\n                margin-bottom: 0.75rem;\n                white-space: nowrap;\n                color: #2557a7;\n            }\n            .card-link {\n                color: #2557a7;\n            }\n            .violationNode {\n                font-size: 0.75rem;\n            }\n            .wrapBreakWord {\n                word-break: break-word;\n            }\n            .summary {\n                font-size: 1rem;\n            }\n            .summarySection {\n                margin: 0.5rem 0;\n            }\n            .hljs {\n                white-space: pre-wrap;\n                width: 100%;\n                background: #f0f0f0;\n            }\n            p {\n                margin-top: 0.3rem;\n            }\n            li {\n                line-height: 1.618;\n            }\n        </style>\n        <!-- Bootstrap CSS -->\n        <link\n            rel=\"stylesheet\"\n            href=\"https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css\"\n            integrity=\"sha384-JcKb8q3iqJ61gNV9KGb8thSsNjpSL0n8PARn9HuZOnIxN0hoP+VmmDGMN5t9UJ0Z\"\n            crossorigin=\"anonymous\"\n        />\n        <script\n            src=\"https://code.jquery.com/jquery-3.2.1.slim.min.js\"\n            integrity=\"sha384-KJ3o2DKtIkvYIK3UENzmM7KCkRr/rE9/Qpg6aAZGJwFDMVNA/GpGFF93hXpG5KkN\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <script\n            src=\"https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js\"\n            integrity=\"sha384-ApNbgh9B+Y1QKtv3Rn7W3mgPxhU9K/ScQsAP7hUibX39j7fakFPskvXusvfa0b4Q\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <script\n            src=\"https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0/js/bootstrap.min.js\"\n            integrity=\"sha384-JZR6Spejh4U02d8jOt6vLEHfe/JQGiRRSQQxSfFWpi1MquVdAyjUar5+76PVCmYl\"\n            crossorigin=\"anonymous\"\n        ></script>\n        <link\n            rel=\"stylesheet\"\n            href=\"//cdnjs.cloudflare.com/ajax/libs/highlight.js/10.5.0/styles/stackoverflow-light.min.css\"\n        />\n        <script src=\"//cdnjs.cloudflare.com/ajax/libs/highlight.js/10.5.0/highlight.min.js\"></script>\n        <link\n            rel=\"icon\"\n            href=\"https://www.deque.com/wp-content/uploads/2018/03/cropped-DQ_SecondaryLogo_HeroBlue_RGB-1-32x32.png\"\n            sizes=\"32x32\"\n        />\n        <title>AXE Accessibility Results</title>\n    </head>\n    <body>\n        <div style=\"padding: 2rem\">\n            <h3>\n                AXE Accessibility Results\n            </h3>\n            <div class=\"summarySection\">\n                <div class=\"summary\">\n                    Page URL:\n                    <a href=\"http:&#x2F;&#x2F;localhost:8123&#x2F;a11y.html\" target=\"_blank\" class=\"card-link\">http:&#x2F;&#x2F;localhost:8123&#x2F;a11y.html</a>\n                    <br />\n                </div>\n            </div>\n            <h5>axe-core found <span class=\"badge badge-warning\">7</span> violations</h5>\n            <table class=\"table table-striped table-bordered\">\n                <thead>\n                    <tr>\n                        <th style=\"width: 5%\">#</th>\n                        <th style=\"width: 45%\">Description</th>\n                        <th style=\"width: 15%\">Axe rule ID</th>\n                        <th style=\"width: 23%\">WCAG</th>\n                        <th style=\"width: 7%\">Impact</th>\n                        <th style=\"width: 5%\">Count</th>\n                    </tr>\n                </thead>\n                <tbody>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#1\" class=\"card-link\">1</a></th>\n                        <td>Documents must have &lt;title&gt; element to aid in navigation</td>\n                        <td>document-title</td>\n                        <td>WCAG 2 Level A, WCAG 2.4.2</td>\n                        <td>serious</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#2\" class=\"card-link\">2</a></th>\n                        <td>&lt;html&gt; element must have a lang attribute</td>\n                        <td>html-has-lang</td>\n                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                        <td>serious</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#3\" class=\"card-link\">3</a></th>\n                        <td>Form elements must have labels</td>\n                        <td>label</td>\n                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                        <td>critical</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#4\" class=\"card-link\">4</a></th>\n                        <td>Document should have one main landmark</td>\n                        <td>landmark-one-main</td>\n                        <td>Best practice</td>\n                        <td>moderate</td>\n                        <td>1</td>\n                    </tr>\n                    <tr>\n                        <th scope=\"row\"><a href=\"#5\" class=\"card-link\">5</a></th>\n                        <td>All page content should be contained by landmarks</td>\n                        <td>region</td>\n                        <td>Best practice</td>\n                        <td>moderate</td>\n                        <td>3</td>\n                    </tr>\n                </tbody>\n            </table>\n            <h3>Failed</h3>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"1\">1.</a> Documents must have &lt;title&gt; element to aid in navigation\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;document-title?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">document-title</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 2.4.2\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures each HTML document contains a non-empty &lt;title&gt; element</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            serious\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.text-alternatives </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag242 </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Document does not have a non-empty &lt;title&gt; element</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"2\">2.</a> &lt;html&gt; element must have a lang attribute\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;html-has-lang?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">html-has-lang</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 3.1.1\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures every HTML document has a lang attribute</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            serious\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.language </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag311 </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  The &lt;html&gt; element does not have a lang attribute</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"3\">3.</a> Form elements must have labels\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;label?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">label</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            WCAG 2 Level A, WCAG 4.1.2\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures every form element has a label</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            critical\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.forms </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag2a </span>\n\n                            <span class=\"badge bg-light text-dark\"> wcag412 </span>\n\n                            <span class=\"badge bg-light text-dark\"> section508 </span>\n\n                            <span class=\"badge bg-light text-dark\"> section508.22.n </span>\n\n                            <span class=\"badge bg-light text-dark\"> ACT </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">#upload-chooser</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;input type&#x3D;&quot;file&quot; name&#x3D;&quot;upload&quot; id&#x3D;&quot;upload-chooser&quot; required&#x3D;&quot;required&quot;&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Form element does not have an implicit (wrapped) &lt;label&gt;</li>\n                                                <li>  Form element does not have an explicit &lt;label&gt;</li>\n                                                <li>  aria-label attribute does not exist or is empty</li>\n                                                <li>  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty</li>\n                                                <li>  Element has no title attribute</li>\n                                                <li>  Element has no placeholder attribute</li>\n                                                <li>  Element&#39;s default semantics were not overridden with role&#x3D;&quot;none&quot; or role&#x3D;&quot;presentation&quot;</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"4\">4.</a> Document should have one main landmark\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;landmark-one-main?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">landmark-one-main</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Best practice\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures the document has a main landmark</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            moderate\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.semantics </span>\n\n                            <span class=\"badge bg-light text-dark\"> best-practice </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">html</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;html&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix all of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Document does not have a main landmark</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div class=\"card violationCard\">\n                <div class=\"card-body\">\n                    <div class=\"violationCardLine\">\n                        <h5 class=\"card-title violationCardTitleItem\">\n                            <a id=\"5\">5.</a> All page content should be contained by landmarks\n                        </h5>\n                        <a\n                            href=\"https:&#x2F;&#x2F;dequeuniversity.com&#x2F;rules&#x2F;axe&#x2F;4.6&#x2F;region?application&#x3D;axeAPI\"\n                            target=\"_blank\"\n                            class=\"card-link violationCardTitleItem learnMore\"\n                            >Learn more</a\n                        >\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted\">region</h6>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Best practice\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <p class=\"card-text\">Ensures all page content is contained by landmarks</p>\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            moderate\n                        </h6>\n                    </div>\n                    <div class=\"violationCardLine\">\n                        <h6 class=\"card-subtitle mb-2 text-muted violationCardTitleItem\">\n                            Issue Tags: \n                            <span class=\"badge bg-light text-dark\"> cat.keyboard </span>\n\n                            <span class=\"badge bg-light text-dark\"> best-practice </span>\n                        </h6>\n                    </div>\n                    <div class=\"violationNode\">\n                        <table class=\"table table-sm table-bordered\">\n                            <thead>\n                                <tr>\n                                    <th style=\"width: 2%\">#</th>\n                                    <th style=\"width: 49%\">Issue Description</th>\n                                    <th style=\"width: 49%\">\n                                        To solve this violation, you need to...\n                                    </th>\n                                </tr>\n                            </thead>\n                            <tbody>\n                                <tr>\n                                    <td>1</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">h1</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;h1&gt;Upload form&lt;&#x2F;h1&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                                <tr>\n                                    <td>2</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">label</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;label for&#x3D;&quot;upload&quot;&gt;upload&lt;&#x2F;label&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                                <tr>\n                                    <td>3</td>\n                                    <td>\n                                        <p><strong>Element location</strong></p>\n                                        <pre><code class=\"css text-wrap\">#upload-chooser</code></pre>\n                                        <p><strong>Element source</strong></p>\n                                        <pre><code class=\"html text-wrap\">&lt;input type&#x3D;&quot;file&quot; name&#x3D;&quot;upload&quot; id&#x3D;&quot;upload-chooser&quot; required&#x3D;&quot;required&quot;&gt;</code></pre>\n                                    </td>\n                                    <td>\n                                        <div class=\"wrapBreakWord\">\n                                            <p>Fix any of the following:</p>\n                                            <ul class=\"text-muted\">\n                                                <li>  Some page content is not contained by landmarks</li>\n                                            </ul>\n                                        </div>\n                                    </td>\n                                </tr>\n                            </tbody>\n                        </table>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionPasses\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingOne\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#passes\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"passes\"\n                            >\n                                axe returned 11 passed axe\n                                checks. Expand details on\n                                click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"passes\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingOne\"\n                        data-parent=\"#accordionPasses\"\n                    >\n                        <div class=\"card-body\">\n                            <table class=\"table table-bordered\">\n                                <thead>\n                                    <tr>\n                                        <th style=\"width: 5%\">#</th>\n                                        <th style=\"width: 40%\">Description</th>\n                                        <th style=\"width: 5%\">Axe rule ID</th>\n                                        <th style=\"width: 15%\">WCAG</th>\n                                        <th style=\"width: 5%\">Nodes passed check</th>\n                                    </tr>\n                                </thead>\n                                <tbody>\n                                    <tr>\n                                        <th scope=\"row\">1</th>\n                                        <td>aria-hidden&#x3D;&#39;true&#39; must not be present on the document body</td>\n                                        <td>aria-hidden-body</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">2</th>\n                                        <td>Buttons must have discernible text</td>\n                                        <td>button-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">3</th>\n                                        <td>Elements must have sufficient color contrast</td>\n                                        <td>color-contrast</td>\n                                        <td>WCAG 2 Level AA, WCAG 1.4.3</td>\n                                        <td>4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">4</th>\n                                        <td>IDs of active elements must be unique</td>\n                                        <td>duplicate-id-active</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                        <td>2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">5</th>\n                                        <td>Headings should not be empty</td>\n                                        <td>empty-heading</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">6</th>\n                                        <td>Form field must not have multiple label elements</td>\n                                        <td>form-field-multiple-labels</td>\n                                        <td>WCAG 2 Level A, WCAG 3.3.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">7</th>\n                                        <td>Heading levels should only increase by one</td>\n                                        <td>heading-order</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">8</th>\n                                        <td>Form elements should have a visible label</td>\n                                        <td>label-title-only</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">9</th>\n                                        <td>Interactive controls must not be nested</td>\n                                        <td>nested-interactive</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">10</th>\n                                        <td>Page should contain a level-one heading</td>\n                                        <td>page-has-heading-one</td>\n                                        <td>Best practice</td>\n                                        <td>1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">11</th>\n                                        <td>All page content should be contained by landmarks</td>\n                                        <td>region</td>\n                                        <td>Best practice</td>\n                                        <td>2</td>\n                                    </tr>\n                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionIncomplete\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingTwo\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#incomplete\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"incomplete\"\n                            >\n                                axe returned 0 incomplete checks. Expand\n                                details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"incomplete\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingTwo\"\n                        data-parent=\"#accordionIncomplete\"\n                    >\n                        <div class=\"card-body\">\n                            <p><em>What 'incomplete' axe checks means?</em></p>\n                            <p>\n                                Incomplete results were aborted and require further testing. This\n                                can happen either because of technical restrictions to what the rule\n                                can test, or because a javascript error occurred.\n                            </p>\n                            <p>\n                                <a\n                                    href=\"https://www.deque.com/axe/core-documentation/api-documentation/#results-object\"\n                                    >Visit axe API Documentation</a\n                                >\n                                to learn more.\n                            </p>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"accordionInapplicable\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"headingThree\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#inapplicable\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"inapplicable\"\n                            >\n                                axe returned 72 inapplicable checks.\n                                Expand details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"inapplicable\"\n                        class=\"collapse\"\n                        aria-labelledby=\"headingThree\"\n                        data-parent=\"#accordionInapplicable\"\n                    >\n                        <div class=\"card-body\">\n                            <p><em>What 'inapplicable' axe checks means?</em></p>\n                            <p>\n                                The inapplicable array lists all the rules for which no matching\n                                elements were found on the page.\n                            </p>\n                            <p>\n                                <a\n                                    href=\"https://www.deque.com/axe/core-documentation/api-documentation/#results-object\"\n                                    >Visit axe API Documentation</a\n                                >\n                                to learn more.\n                            </p>\n                            <table class=\"table table-bordered\">\n                                <thead>\n                                    <tr>\n                                        <th style=\"width: 5%\">#</th>\n                                        <th style=\"width: 50%\">Description</th>\n                                        <th style=\"width: 20%\">Axe rule ID</th>\n                                        <th style=\"width: 15%\">WCAG</th>\n                                    </tr>\n                                </thead>\n                                <tbody>\n                                    <tr>\n                                        <th scope=\"row\">1</th>\n                                        <td>accesskey attribute value should be unique</td>\n                                        <td>accesskeys</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">2</th>\n                                        <td>Active &lt;area&gt; elements must have alternate text</td>\n                                        <td>area-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 2.4.4, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">3</th>\n                                        <td>Elements must only use allowed ARIA attributes</td>\n                                        <td>aria-allowed-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">4</th>\n                                        <td>ARIA role should be appropriate for the element</td>\n                                        <td>aria-allowed-role</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">5</th>\n                                        <td>ARIA commands must have an accessible name</td>\n                                        <td>aria-command-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">6</th>\n                                        <td>ARIA dialog and alertdialog nodes should have an accessible name</td>\n                                        <td>aria-dialog-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">7</th>\n                                        <td>ARIA hidden element must not be focusable or contain focusable elements</td>\n                                        <td>aria-hidden-focus</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">8</th>\n                                        <td>ARIA input fields must have an accessible name</td>\n                                        <td>aria-input-field-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">9</th>\n                                        <td>ARIA meter nodes must have an accessible name</td>\n                                        <td>aria-meter-name</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">10</th>\n                                        <td>ARIA progressbar nodes must have an accessible name</td>\n                                        <td>aria-progressbar-name</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">11</th>\n                                        <td>Required ARIA attributes must be provided</td>\n                                        <td>aria-required-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">12</th>\n                                        <td>Certain ARIA roles must contain particular children</td>\n                                        <td>aria-required-children</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">13</th>\n                                        <td>Certain ARIA roles must be contained by particular parents</td>\n                                        <td>aria-required-parent</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">14</th>\n                                        <td>aria-roledescription must be on elements with a semantic role</td>\n                                        <td>aria-roledescription</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">15</th>\n                                        <td>ARIA roles used must conform to valid values</td>\n                                        <td>aria-roles</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">16</th>\n                                        <td>&quot;role&#x3D;text&quot; should have no focusable descendants</td>\n                                        <td>aria-text</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">17</th>\n                                        <td>ARIA toggle fields must have an accessible name</td>\n                                        <td>aria-toggle-field-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">18</th>\n                                        <td>ARIA tooltip nodes must have an accessible name</td>\n                                        <td>aria-tooltip-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">19</th>\n                                        <td>ARIA treeitem nodes should have an accessible name</td>\n                                        <td>aria-treeitem-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">20</th>\n                                        <td>ARIA attributes must conform to valid values</td>\n                                        <td>aria-valid-attr-value</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">21</th>\n                                        <td>ARIA attributes must conform to valid names</td>\n                                        <td>aria-valid-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">22</th>\n                                        <td>autocomplete attribute must be used correctly</td>\n                                        <td>autocomplete-valid</td>\n                                        <td>WCAG 2.1 Level AA, WCAG 1.3.5</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">23</th>\n                                        <td>Inline text spacing must be adjustable with custom stylesheets</td>\n                                        <td>avoid-inline-spacing</td>\n                                        <td>WCAG 2.1 Level AA, WCAG 1.4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">24</th>\n                                        <td>&lt;blink&gt; elements are deprecated and must not be used</td>\n                                        <td>blink</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">25</th>\n                                        <td>Page must have means to bypass repeated blocks</td>\n                                        <td>bypass</td>\n                                        <td>WCAG 2 Level A, WCAG 2.4.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">26</th>\n                                        <td>&lt;dl&gt; elements must only directly contain properly-ordered &lt;dt&gt; and &lt;dd&gt; groups, &lt;script&gt;, &lt;template&gt; or &lt;div&gt; elements</td>\n                                        <td>definition-list</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">27</th>\n                                        <td>&lt;dt&gt; and &lt;dd&gt; elements must be contained by a &lt;dl&gt;</td>\n                                        <td>dlitem</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">28</th>\n                                        <td>IDs used in ARIA and labels must be unique</td>\n                                        <td>duplicate-id-aria</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">29</th>\n                                        <td>id attribute value must be unique</td>\n                                        <td>duplicate-id</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">30</th>\n                                        <td>Table header text should not be empty</td>\n                                        <td>empty-table-header</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">31</th>\n                                        <td>Frames with focusable content must not have tabindex&#x3D;-1</td>\n                                        <td>frame-focusable-content</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">32</th>\n                                        <td>Frames should be tested with axe-core</td>\n                                        <td>frame-tested</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">33</th>\n                                        <td>Frames must have a unique title attribute</td>\n                                        <td>frame-title-unique</td>\n                                        <td>WCAG 4.1.2, WCAG 2 Level A</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">34</th>\n                                        <td>Frames must have an accessible name</td>\n                                        <td>frame-title</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">35</th>\n                                        <td>&lt;html&gt; element must have a valid value for the lang attribute</td>\n                                        <td>html-lang-valid</td>\n                                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">36</th>\n                                        <td>HTML elements with lang and xml:lang must have the same base language</td>\n                                        <td>html-xml-lang-mismatch</td>\n                                        <td>WCAG 2 Level A, WCAG 3.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">37</th>\n                                        <td>Images must have alternate text</td>\n                                        <td>image-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">38</th>\n                                        <td>Alternative text of images should not be repeated as text</td>\n                                        <td>image-redundant-alt</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">39</th>\n                                        <td>Input buttons must have discernible text</td>\n                                        <td>input-button-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">40</th>\n                                        <td>Image buttons must have alternate text</td>\n                                        <td>input-image-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">41</th>\n                                        <td>Banner landmark should not be contained in another landmark</td>\n                                        <td>landmark-banner-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">42</th>\n                                        <td>Aside should not be contained in another landmark</td>\n                                        <td>landmark-complementary-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">43</th>\n                                        <td>Contentinfo landmark should not be contained in another landmark</td>\n                                        <td>landmark-contentinfo-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">44</th>\n                                        <td>Main landmark should not be contained in another landmark</td>\n                                        <td>landmark-main-is-top-level</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">45</th>\n                                        <td>Document should not have more than one banner landmark</td>\n                                        <td>landmark-no-duplicate-banner</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">46</th>\n                                        <td>Document should not have more than one contentinfo landmark</td>\n                                        <td>landmark-no-duplicate-contentinfo</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">47</th>\n                                        <td>Document should not have more than one main landmark</td>\n                                        <td>landmark-no-duplicate-main</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">48</th>\n                                        <td>Ensures landmarks are unique</td>\n                                        <td>landmark-unique</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">49</th>\n                                        <td>Links must be distinguishable without relying on color</td>\n                                        <td>link-in-text-block</td>\n                                        <td>WCAG 2 Level A, WCAG 1.4.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">50</th>\n                                        <td>Links must have discernible text</td>\n                                        <td>link-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2, WCAG 2.4.4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">51</th>\n                                        <td>&lt;ul&gt; and &lt;ol&gt; must only directly contain &lt;li&gt;, &lt;script&gt; or &lt;template&gt; elements</td>\n                                        <td>list</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">52</th>\n                                        <td>&lt;li&gt; elements must be contained in a &lt;ul&gt; or &lt;ol&gt;</td>\n                                        <td>listitem</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">53</th>\n                                        <td>&lt;marquee&gt; elements are deprecated and must not be used</td>\n                                        <td>marquee</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">54</th>\n                                        <td>Delayed refresh under 20 hours must not be used</td>\n                                        <td>meta-refresh</td>\n                                        <td>WCAG 2 Level A, WCAG 2.2.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">55</th>\n                                        <td>Users should be able to zoom and scale the text up to 500%</td>\n                                        <td>meta-viewport-large</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">56</th>\n                                        <td>Zooming and scaling must not be disabled</td>\n                                        <td>meta-viewport</td>\n                                        <td>WCAG 2 Level AA, WCAG 1.4.4</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">57</th>\n                                        <td>&lt;object&gt; elements must have alternate text</td>\n                                        <td>object-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">58</th>\n                                        <td>Ensure elements marked as presentational are consistently ignored</td>\n                                        <td>presentation-role-conflict</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">59</th>\n                                        <td>[role&#x3D;&#39;img&#39;] elements must have an alternative text</td>\n                                        <td>role-img-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">60</th>\n                                        <td>scope attribute should be used correctly</td>\n                                        <td>scope-attr-valid</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">61</th>\n                                        <td>Scrollable region must have keyboard access</td>\n                                        <td>scrollable-region-focusable</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">62</th>\n                                        <td>Select element must have an accessible name</td>\n                                        <td>select-name</td>\n                                        <td>WCAG 2 Level A, WCAG 4.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">63</th>\n                                        <td>Server-side image maps must not be used</td>\n                                        <td>server-side-image-map</td>\n                                        <td>WCAG 2 Level A, WCAG 2.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">64</th>\n                                        <td>The skip-link target should exist and be focusable</td>\n                                        <td>skip-link</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">65</th>\n                                        <td>&lt;svg&gt; elements with an img role must have an alternative text</td>\n                                        <td>svg-img-alt</td>\n                                        <td>WCAG 2 Level A, WCAG 1.1.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">66</th>\n                                        <td>Elements should not have tabindex greater than zero</td>\n                                        <td>tabindex</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">67</th>\n                                        <td>tables should not have the same summary and caption</td>\n                                        <td>table-duplicate-name</td>\n                                        <td>Best practice</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">68</th>\n                                        <td>Table cells that use the headers attribute must only refer to cells in the same table</td>\n                                        <td>td-headers-attr</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">69</th>\n                                        <td>Table headers in a data table must refer to data cells</td>\n                                        <td>th-has-data-cells</td>\n                                        <td>WCAG 2 Level A, WCAG 1.3.1</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">70</th>\n                                        <td>lang attribute must have a valid value</td>\n                                        <td>valid-lang</td>\n                                        <td>WCAG 2 Level AA, WCAG 3.1.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">71</th>\n                                        <td>&lt;video&gt; elements must have captions</td>\n                                        <td>video-caption</td>\n                                        <td>WCAG 2 Level A, WCAG 1.2.2</td>\n                                    </tr>\n                                </tbody>\n                                    <tr>\n                                        <th scope=\"row\">72</th>\n                                        <td>&lt;video&gt; or &lt;audio&gt; elements must not play automatically</td>\n                                        <td>no-autoplay-audio</td>\n                                        <td>WCAG 2 Level A, WCAG 1.4.2</td>\n                                    </tr>\n                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>\n            </div>\n            <div id=\"rulesSection\">\n                <div class=\"card\">\n                    <div class=\"card-header\" id=\"ruleSection\">\n                        <h5 class=\"mb-0\">\n                            <button\n                                class=\"btn btn-link\"\n                                data-toggle=\"collapse\"\n                                data-target=\"#rules\"\n                                aria-expanded=\"false\"\n                                aria-controls=\"inapplicable\"\n                            >\n                                axe was running with 0 rules. Expand details on click\n                            </button>\n                        </h5>\n                    </div>\n                    <div\n                        id=\"rules\"\n                        class=\"collapse\"\n                        aria-labelledby=\"ruleSection\"\n                        data-parent=\"#rules\"\n                    >\n                        <div class=\"card-body\">\n                        </div>\n                    </div>\n                </div>\n            </div>\n        </div>\n\n        <script>\n            hljs.initHighlightingOnLoad();\n        </script>\n    </body>\n</html>\n"
                    },
                    "details": {
                      "axeReport": {
                        "testEngine": {
                          "name": "axe-core",
                          "version": "4.6.3"
                        },
                        "testRunner": {
                          "name": "axe"
                        },
                        "testEnvironment": {
                          "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
                          "windowWidth": 1280,
                          "windowHeight": 720,
                          "orientationAngle": 0,
                          "orientationType": "landscape-primary"
                        },
                        "timestamp": "2023-10-06T11:53:18.239Z",
                        "url": "http://localhost:8123/a11y.html",
                        "toolOptions": {
                          "reporter": "v1"
                        },
                        "inapplicable": [
                          {
                            "id": "accesskeys",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "best-practice"
                            ],
                            "description": "Ensures every accesskey attribute value is unique",
                            "help": "accesskey attribute value should be unique",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/accesskeys?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "area-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag244",
                              "wcag412",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures <area> elements of image maps have alternate text",
                            "help": "Active <area> elements must have alternate text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/area-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-allowed-attr",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures ARIA attributes are allowed for an element's role",
                            "help": "Elements must only use allowed ARIA attributes",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-allowed-attr?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-allowed-role",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "best-practice"
                            ],
                            "description": "Ensures role attribute has an appropriate value for the element",
                            "help": "ARIA role should be appropriate for the element",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-allowed-role?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-command-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412",
                              "ACT"
                            ],
                            "description": "Ensures every ARIA button, link and menuitem has an accessible name",
                            "help": "ARIA commands must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-command-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-dialog-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "best-practice"
                            ],
                            "description": "Ensures every ARIA dialog and alertdialog node has an accessible name",
                            "help": "ARIA dialog and alertdialog nodes should have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-dialog-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-hidden-focus",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures aria-hidden elements are not focusable nor contain focusable elements",
                            "help": "ARIA hidden element must not be focusable or contain focusable elements",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-hidden-focus?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-input-field-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412",
                              "ACT"
                            ],
                            "description": "Ensures every ARIA input field has an accessible name",
                            "help": "ARIA input fields must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-input-field-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-meter-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag111"
                            ],
                            "description": "Ensures every ARIA meter node has an accessible name",
                            "help": "ARIA meter nodes must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-meter-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-progressbar-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag111"
                            ],
                            "description": "Ensures every ARIA progressbar node has an accessible name",
                            "help": "ARIA progressbar nodes must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-progressbar-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-required-attr",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures elements with ARIA roles have all required ARIA attributes",
                            "help": "Required ARIA attributes must be provided",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-required-attr?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-required-children",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures elements with an ARIA role that require child roles contain them",
                            "help": "Certain ARIA roles must contain particular children",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-required-children?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-required-parent",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures elements with an ARIA role that require parent roles are contained by them",
                            "help": "Certain ARIA roles must be contained by particular parents",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-required-parent?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-roledescription",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensure aria-roledescription is only used on elements with an implicit or explicit role",
                            "help": "aria-roledescription must be on elements with a semantic role",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-roledescription?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-roles",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures all elements with a role attribute use a valid value",
                            "help": "ARIA roles used must conform to valid values",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-roles?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-text",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "best-practice"
                            ],
                            "description": "Ensures \"role=text\" is used on elements with no focusable descendants",
                            "help": "\"role=text\" should have no focusable descendants",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-text?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-toggle-field-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412",
                              "ACT"
                            ],
                            "description": "Ensures every ARIA toggle field has an accessible name",
                            "help": "ARIA toggle fields must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-toggle-field-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-tooltip-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures every ARIA tooltip node has an accessible name",
                            "help": "ARIA tooltip nodes must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-tooltip-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-treeitem-name",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "best-practice"
                            ],
                            "description": "Ensures every ARIA treeitem node has an accessible name",
                            "help": "ARIA treeitem nodes should have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-treeitem-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-valid-attr-value",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures all ARIA attributes have valid values",
                            "help": "ARIA attributes must conform to valid values",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-valid-attr-value?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "aria-valid-attr",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures attributes that begin with aria- are valid ARIA attributes",
                            "help": "ARIA attributes must conform to valid names",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-valid-attr?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "autocomplete-valid",
                            "impact": null,
                            "tags": [
                              "cat.forms",
                              "wcag21aa",
                              "wcag135",
                              "ACT"
                            ],
                            "description": "Ensure the autocomplete attribute is correct and suitable for the form field",
                            "help": "autocomplete attribute must be used correctly",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/autocomplete-valid?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "avoid-inline-spacing",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "wcag21aa",
                              "wcag1412",
                              "ACT"
                            ],
                            "description": "Ensure that text spacing set through style attributes can be adjusted with custom stylesheets",
                            "help": "Inline text spacing must be adjustable with custom stylesheets",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/avoid-inline-spacing?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "blink",
                            "impact": null,
                            "tags": [
                              "cat.time-and-media",
                              "wcag2a",
                              "wcag222",
                              "section508",
                              "section508.22.j"
                            ],
                            "description": "Ensures <blink> elements are not used",
                            "help": "<blink> elements are deprecated and must not be used",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/blink?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "bypass",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "wcag2a",
                              "wcag241",
                              "section508",
                              "section508.22.o"
                            ],
                            "description": "Ensures each page has at least one mechanism for a user to bypass navigation and jump straight to the content",
                            "help": "Page must have means to bypass repeated blocks",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/bypass?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "definition-list",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures <dl> elements are structured correctly",
                            "help": "<dl> elements must only directly contain properly-ordered <dt> and <dd> groups, <script>, <template> or <div> elements",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/definition-list?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "dlitem",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures <dt> and <dd> elements are contained by a <dl>",
                            "help": "<dt> and <dd> elements must be contained by a <dl>",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/dlitem?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "duplicate-id-aria",
                            "impact": null,
                            "tags": [
                              "cat.parsing",
                              "wcag2a",
                              "wcag411"
                            ],
                            "description": "Ensures every id attribute value used in ARIA and in labels is unique",
                            "help": "IDs used in ARIA and labels must be unique",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/duplicate-id-aria?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "duplicate-id",
                            "impact": null,
                            "tags": [
                              "cat.parsing",
                              "wcag2a",
                              "wcag411"
                            ],
                            "description": "Ensures every id attribute value is unique",
                            "help": "id attribute value must be unique",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/duplicate-id?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "empty-table-header",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "best-practice"
                            ],
                            "description": "Ensures table headers have discernible text",
                            "help": "Table header text should not be empty",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/empty-table-header?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "frame-focusable-content",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "wcag2a",
                              "wcag211"
                            ],
                            "description": "Ensures <frame> and <iframe> elements with focusable content do not have tabindex=-1",
                            "help": "Frames with focusable content must not have tabindex=-1",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/frame-focusable-content?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "frame-tested",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "review-item",
                              "best-practice"
                            ],
                            "description": "Ensures <iframe> and <frame> elements contain the axe-core script",
                            "help": "Frames should be tested with axe-core",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/frame-tested?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "frame-title-unique",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag412",
                              "wcag2a"
                            ],
                            "description": "Ensures <iframe> and <frame> elements contain a unique title attribute",
                            "help": "Frames must have a unique title attribute",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/frame-title-unique?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "frame-title",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag412",
                              "section508",
                              "section508.22.i"
                            ],
                            "description": "Ensures <iframe> and <frame> elements have an accessible name",
                            "help": "Frames must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/frame-title?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "html-lang-valid",
                            "impact": null,
                            "tags": [
                              "cat.language",
                              "wcag2a",
                              "wcag311",
                              "ACT"
                            ],
                            "description": "Ensures the lang attribute of the <html> element has a valid value",
                            "help": "<html> element must have a valid value for the lang attribute",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/html-lang-valid?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "html-xml-lang-mismatch",
                            "impact": null,
                            "tags": [
                              "cat.language",
                              "wcag2a",
                              "wcag311",
                              "ACT"
                            ],
                            "description": "Ensure that HTML elements with both valid lang and xml:lang attributes agree on the base language of the page",
                            "help": "HTML elements with lang and xml:lang must have the same base language",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/html-xml-lang-mismatch?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "image-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag111",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures <img> elements have alternate text or a role of none or presentation",
                            "help": "Images must have alternate text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/image-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "image-redundant-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "best-practice"
                            ],
                            "description": "Ensure image alternative is not repeated as text",
                            "help": "Alternative text of images should not be repeated as text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/image-redundant-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "input-button-name",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "wcag2a",
                              "wcag412",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures input buttons have discernible text",
                            "help": "Input buttons must have discernible text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/input-button-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "input-image-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag111",
                              "wcag412",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures <input type=\"image\"> elements have alternate text",
                            "help": "Image buttons must have alternate text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/input-image-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-banner-is-top-level",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the banner landmark is at top level",
                            "help": "Banner landmark should not be contained in another landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-banner-is-top-level?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-complementary-is-top-level",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the complementary landmark or aside is at top level",
                            "help": "Aside should not be contained in another landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-complementary-is-top-level?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-contentinfo-is-top-level",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the contentinfo landmark is at top level",
                            "help": "Contentinfo landmark should not be contained in another landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-contentinfo-is-top-level?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-main-is-top-level",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the main landmark is at top level",
                            "help": "Main landmark should not be contained in another landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-main-is-top-level?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-no-duplicate-banner",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the document has at most one banner landmark",
                            "help": "Document should not have more than one banner landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-no-duplicate-banner?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-no-duplicate-contentinfo",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the document has at most one contentinfo landmark",
                            "help": "Document should not have more than one contentinfo landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-no-duplicate-contentinfo?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-no-duplicate-main",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the document has at most one main landmark",
                            "help": "Document should not have more than one main landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-no-duplicate-main?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "landmark-unique",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "help": "Ensures landmarks are unique",
                            "description": "Landmarks should have a unique role or role/label/title (i.e. accessible name) combination",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-unique?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "link-in-text-block",
                            "impact": null,
                            "tags": [
                              "cat.color",
                              "wcag2a",
                              "wcag141"
                            ],
                            "description": "Ensure links are distinguished from surrounding text in a way that does not rely on color",
                            "help": "Links must be distinguishable without relying on color",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/link-in-text-block?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "link-name",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "wcag2a",
                              "wcag412",
                              "wcag244",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures links have discernible text",
                            "help": "Links must have discernible text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/link-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "list",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures that lists are structured correctly",
                            "help": "<ul> and <ol> must only directly contain <li>, <script> or <template> elements",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/list?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "listitem",
                            "impact": null,
                            "tags": [
                              "cat.structure",
                              "wcag2a",
                              "wcag131"
                            ],
                            "description": "Ensures <li> elements are used semantically",
                            "help": "<li> elements must be contained in a <ul> or <ol>",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/listitem?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "marquee",
                            "impact": null,
                            "tags": [
                              "cat.parsing",
                              "wcag2a",
                              "wcag222"
                            ],
                            "description": "Ensures <marquee> elements are not used",
                            "help": "<marquee> elements are deprecated and must not be used",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/marquee?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "meta-refresh",
                            "impact": null,
                            "tags": [
                              "cat.time-and-media",
                              "wcag2a",
                              "wcag221"
                            ],
                            "description": "Ensures <meta http-equiv=\"refresh\"> is not used for delayed refresh",
                            "help": "Delayed refresh under 20 hours must not be used",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/meta-refresh?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "meta-viewport-large",
                            "impact": null,
                            "tags": [
                              "cat.sensory-and-visual-cues",
                              "best-practice"
                            ],
                            "description": "Ensures <meta name=\"viewport\"> can scale a significant amount",
                            "help": "Users should be able to zoom and scale the text up to 500%",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/meta-viewport-large?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "meta-viewport",
                            "impact": null,
                            "tags": [
                              "cat.sensory-and-visual-cues",
                              "wcag2aa",
                              "wcag144",
                              "ACT"
                            ],
                            "description": "Ensures <meta name=\"viewport\"> does not disable text scaling and zooming",
                            "help": "Zooming and scaling must not be disabled",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/meta-viewport?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "object-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag111",
                              "section508",
                              "section508.22.a"
                            ],
                            "description": "Ensures <object> elements have alternate text",
                            "help": "<object> elements must have alternate text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/object-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "presentation-role-conflict",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "best-practice",
                              "ACT"
                            ],
                            "description": "Elements marked as presentational should not have global ARIA or tabindex to ensure all screen readers ignore them",
                            "help": "Ensure elements marked as presentational are consistently ignored",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/presentation-role-conflict?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "role-img-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag111",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures [role='img'] elements have alternate text",
                            "help": "[role='img'] elements must have an alternative text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/role-img-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "scope-attr-valid",
                            "impact": null,
                            "tags": [
                              "cat.tables",
                              "best-practice"
                            ],
                            "description": "Ensures the scope attribute is used correctly on tables",
                            "help": "scope attribute should be used correctly",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/scope-attr-valid?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "scrollable-region-focusable",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "wcag2a",
                              "wcag211"
                            ],
                            "description": "Ensure elements that have scrollable content are accessible by keyboard",
                            "help": "Scrollable region must have keyboard access",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/scrollable-region-focusable?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "select-name",
                            "impact": null,
                            "tags": [
                              "cat.forms",
                              "wcag2a",
                              "wcag412",
                              "section508",
                              "section508.22.n",
                              "ACT"
                            ],
                            "description": "Ensures select element has an accessible name",
                            "help": "Select element must have an accessible name",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/select-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "server-side-image-map",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag211",
                              "section508",
                              "section508.22.f"
                            ],
                            "description": "Ensures that server-side image maps are not used",
                            "help": "Server-side image maps must not be used",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/server-side-image-map?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "skip-link",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "best-practice"
                            ],
                            "description": "Ensure all skip links have a focusable target",
                            "help": "The skip-link target should exist and be focusable",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/skip-link?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "svg-img-alt",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag111",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures <svg> elements with an img, graphics-document or graphics-symbol role have an accessible text",
                            "help": "<svg> elements with an img role must have an alternative text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/svg-img-alt?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "tabindex",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "best-practice"
                            ],
                            "description": "Ensures tabindex attribute values are not greater than 0",
                            "help": "Elements should not have tabindex greater than zero",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/tabindex?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "table-duplicate-name",
                            "impact": null,
                            "tags": [
                              "cat.tables",
                              "best-practice"
                            ],
                            "description": "Ensure the <caption> element does not contain the same text as the summary attribute",
                            "help": "tables should not have the same summary and caption",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/table-duplicate-name?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "td-headers-attr",
                            "impact": null,
                            "tags": [
                              "cat.tables",
                              "wcag2a",
                              "wcag131",
                              "section508",
                              "section508.22.g"
                            ],
                            "description": "Ensure that each cell in a table that uses the headers attribute refers only to other cells in that table",
                            "help": "Table cells that use the headers attribute must only refer to cells in the same table",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/td-headers-attr?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "th-has-data-cells",
                            "impact": null,
                            "tags": [
                              "cat.tables",
                              "wcag2a",
                              "wcag131",
                              "section508",
                              "section508.22.g"
                            ],
                            "description": "Ensure that <th> elements and elements with role=columnheader/rowheader have data cells they describe",
                            "help": "Table headers in a data table must refer to data cells",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/th-has-data-cells?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "valid-lang",
                            "impact": null,
                            "tags": [
                              "cat.language",
                              "wcag2aa",
                              "wcag312",
                              "ACT"
                            ],
                            "description": "Ensures lang attributes have valid values",
                            "help": "lang attribute must have a valid value",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/valid-lang?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "video-caption",
                            "impact": null,
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag122",
                              "section508",
                              "section508.22.a"
                            ],
                            "description": "Ensures <video> elements have captions",
                            "help": "<video> elements must have captions",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/video-caption?application=axeAPI",
                            "nodes": []
                          },
                          {
                            "id": "no-autoplay-audio",
                            "impact": null,
                            "tags": [
                              "cat.time-and-media",
                              "wcag2a",
                              "wcag142",
                              "ACT"
                            ],
                            "description": "Ensures <video> or <audio> elements do not autoplay audio for more than 3 seconds without a control mechanism to stop or mute the audio",
                            "help": "<video> or <audio> elements must not play automatically",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/no-autoplay-audio?application=axeAPI",
                            "nodes": []
                          }
                        ],
                        "passes": [
                          {
                            "id": "aria-hidden-body",
                            "impact": null,
                            "tags": [
                              "cat.aria",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures aria-hidden='true' is not present on the document body.",
                            "help": "aria-hidden='true' must not be present on the document body",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/aria-hidden-body?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "aria-hidden-body",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "critical",
                                    "message": "No aria-hidden attribute is present on document body"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<body>",
                                "target": [
                                  "body"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "button-name",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "wcag2a",
                              "wcag412",
                              "section508",
                              "section508.22.a",
                              "ACT"
                            ],
                            "description": "Ensures buttons have discernible text",
                            "help": "Buttons must have discernible text",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/button-name?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "button-has-visible-text",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "critical",
                                    "message": "Element has inner text that is visible to screen readers"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>",
                                "target": [
                                  "#upload-submit"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "color-contrast",
                            "impact": null,
                            "tags": [
                              "cat.color",
                              "wcag2aa",
                              "wcag143",
                              "ACT"
                            ],
                            "description": "Ensures the contrast between foreground and background colors meets WCAG 2 AA contrast ratio thresholds",
                            "help": "Elements must have sufficient color contrast",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/color-contrast?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "color-contrast",
                                    "data": {
                                      "fgColor": "#000000",
                                      "bgColor": "#ffffff",
                                      "contrastRatio": 21,
                                      "fontSize": "24.0pt (32px)",
                                      "fontWeight": "bold",
                                      "expectedContrastRatio": "3:1"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has sufficient color contrast of 21"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<h1>Upload form</h1>",
                                "target": [
                                  "h1"
                                ]
                              },
                              {
                                "any": [
                                  {
                                    "id": "color-contrast",
                                    "data": {
                                      "fgColor": "#000000",
                                      "bgColor": "#ffffff",
                                      "contrastRatio": 21,
                                      "fontSize": "12.0pt (16px)",
                                      "fontWeight": "normal",
                                      "expectedContrastRatio": "4.5:1"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has sufficient color contrast of 21"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<label for=\"upload\">upload</label>",
                                "target": [
                                  "label"
                                ]
                              },
                              {
                                "any": [
                                  {
                                    "id": "color-contrast",
                                    "data": {
                                      "fgColor": "#000000",
                                      "bgColor": "#ffffff",
                                      "contrastRatio": 21,
                                      "fontSize": "10.0pt (13.3333px)",
                                      "fontWeight": "normal",
                                      "expectedContrastRatio": "4.5:1"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has sufficient color contrast of 21"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ]
                              },
                              {
                                "any": [
                                  {
                                    "id": "color-contrast",
                                    "data": {
                                      "fgColor": "#000000",
                                      "bgColor": "#efefef",
                                      "contrastRatio": 18.26,
                                      "fontSize": "10.0pt (13.3333px)",
                                      "fontWeight": "normal",
                                      "expectedContrastRatio": "4.5:1"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has sufficient color contrast of 18.26"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>",
                                "target": [
                                  "#upload-submit"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "duplicate-id-active",
                            "impact": null,
                            "tags": [
                              "cat.parsing",
                              "wcag2a",
                              "wcag411"
                            ],
                            "description": "Ensures every id attribute value of active elements is unique",
                            "help": "IDs of active elements must be unique",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/duplicate-id-active?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "duplicate-id-active",
                                    "data": "upload-chooser",
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Document has no active elements that share the same id attribute"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ]
                              },
                              {
                                "any": [
                                  {
                                    "id": "duplicate-id-active",
                                    "data": "upload-submit",
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Document has no active elements that share the same id attribute"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>",
                                "target": [
                                  "#upload-submit"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "empty-heading",
                            "impact": null,
                            "tags": [
                              "cat.name-role-value",
                              "best-practice"
                            ],
                            "description": "Ensures headings have discernible text",
                            "help": "Headings should not be empty",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/empty-heading?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "has-visible-text",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "minor",
                                    "message": "Element has text that is visible to screen readers"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<h1>Upload form</h1>",
                                "target": [
                                  "h1"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "form-field-multiple-labels",
                            "impact": null,
                            "tags": [
                              "cat.forms",
                              "wcag2a",
                              "wcag332"
                            ],
                            "description": "Ensures form field does not have multiple label elements",
                            "help": "Form field must not have multiple label elements",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/form-field-multiple-labels?application=axeAPI",
                            "nodes": [
                              {
                                "any": [],
                                "all": [],
                                "none": [
                                  {
                                    "id": "multiple-label",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Form field does not have multiple label elements"
                                  }
                                ],
                                "impact": null,
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "heading-order",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the order of headings is semantically correct",
                            "help": "Heading levels should only increase by one",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/heading-order?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "heading-order",
                                    "data": {
                                      "headingOrder": [
                                        {
                                          "ancestry": [
                                            "html > body > h1:nth-child(1)"
                                          ],
                                          "level": 1
                                        }
                                      ]
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Heading order valid"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<h1>Upload form</h1>",
                                "target": [
                                  "h1"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "label-title-only",
                            "impact": null,
                            "tags": [
                              "cat.forms",
                              "best-practice"
                            ],
                            "description": "Ensures that every form element has a visible label and is not solely labeled using hidden labels, or the title or aria-describedby attributes",
                            "help": "Form elements should have a visible label",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/label-title-only?application=axeAPI",
                            "nodes": [
                              {
                                "any": [],
                                "all": [],
                                "none": [
                                  {
                                    "id": "title-only",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Form element does not solely use title attribute for its label"
                                  }
                                ],
                                "impact": null,
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "nested-interactive",
                            "impact": null,
                            "tags": [
                              "cat.keyboard",
                              "wcag2a",
                              "wcag412"
                            ],
                            "description": "Ensures interactive controls are not nested as they are not always announced by screen readers or can cause focus problems for assistive technologies",
                            "help": "Interactive controls must not be nested",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/nested-interactive?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "no-focusable-content",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element does not have focusable descendants"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>",
                                "target": [
                                  "#upload-submit"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "page-has-heading-one",
                            "impact": null,
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensure that the page, or at least one of its frames contains a level-one heading",
                            "help": "Page should contain a level-one heading",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/page-has-heading-one?application=axeAPI",
                            "nodes": [
                              {
                                "any": [],
                                "all": [
                                  {
                                    "id": "page-has-heading-one",
                                    "data": null,
                                    "relatedNodes": [
                                      {
                                        "html": "<h1>Upload form</h1>",
                                        "target": [
                                          "h1"
                                        ]
                                      }
                                    ],
                                    "impact": "moderate",
                                    "message": "Page has at least one level-one heading"
                                  }
                                ],
                                "none": [],
                                "impact": null,
                                "html": "<html>",
                                "target": [
                                  "html"
                                ]
                              }
                            ]
                          },
                          {
                            "id": "region",
                            "impact": "moderate",
                            "tags": [
                              "cat.keyboard",
                              "best-practice"
                            ],
                            "description": "Ensures all page content is contained by landmarks",
                            "help": "All page content should be contained by landmarks",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/region?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "region",
                                    "data": {
                                      "isIframe": false
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "All page content is contained by landmarks"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<form method=\"post\" action=\"/upload\" enctype=\"multipart/form-data\">\n    <label for=\"upload\">upload</label> \n        <input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">\n    <button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>\n</form>",
                                "target": [
                                  "form"
                                ]
                              },
                              {
                                "any": [
                                  {
                                    "id": "region",
                                    "data": {
                                      "isIframe": false
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "All page content is contained by landmarks"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": null,
                                "html": "<button type=\"submit\" value=\"Upload\" id=\"upload-submit\">Upload</button>",
                                "target": [
                                  "#upload-submit"
                                ]
                              }
                            ]
                          }
                        ],
                        "incomplete": [],
                        "violations": [
                          {
                            "id": "document-title",
                            "impact": "serious",
                            "tags": [
                              "cat.text-alternatives",
                              "wcag2a",
                              "wcag242",
                              "ACT"
                            ],
                            "description": "Ensures each HTML document contains a non-empty <title> element",
                            "help": "Documents must have <title> element to aid in navigation",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/document-title?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "doc-has-title",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Document does not have a non-empty <title> element"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "serious",
                                "html": "<html>",
                                "target": [
                                  "html"
                                ],
                                "failureSummary": "Fix any of the following:\n  Document does not have a non-empty <title> element"
                              }
                            ]
                          },
                          {
                            "id": "html-has-lang",
                            "impact": "serious",
                            "tags": [
                              "cat.language",
                              "wcag2a",
                              "wcag311",
                              "ACT"
                            ],
                            "description": "Ensures every HTML document has a lang attribute",
                            "help": "<html> element must have a lang attribute",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/html-has-lang?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "has-lang",
                                    "data": {
                                      "messageKey": "noLang"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "The <html> element does not have a lang attribute"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "serious",
                                "html": "<html>",
                                "target": [
                                  "html"
                                ],
                                "failureSummary": "Fix any of the following:\n  The <html> element does not have a lang attribute"
                              }
                            ]
                          },
                          {
                            "id": "label",
                            "impact": "critical",
                            "tags": [
                              "cat.forms",
                              "wcag2a",
                              "wcag412",
                              "section508",
                              "section508.22.n",
                              "ACT"
                            ],
                            "description": "Ensures every form element has a label",
                            "help": "Form elements must have labels",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/label?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "implicit-label",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "critical",
                                    "message": "Form element does not have an implicit (wrapped) <label>"
                                  },
                                  {
                                    "id": "explicit-label",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "critical",
                                    "message": "Form element does not have an explicit <label>"
                                  },
                                  {
                                    "id": "aria-label",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "aria-label attribute does not exist or is empty"
                                  },
                                  {
                                    "id": "aria-labelledby",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty"
                                  },
                                  {
                                    "id": "non-empty-title",
                                    "data": {
                                      "messageKey": "noAttr"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has no title attribute"
                                  },
                                  {
                                    "id": "non-empty-placeholder",
                                    "data": {
                                      "messageKey": "noAttr"
                                    },
                                    "relatedNodes": [],
                                    "impact": "serious",
                                    "message": "Element has no placeholder attribute"
                                  },
                                  {
                                    "id": "presentational-role",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "minor",
                                    "message": "Element's default semantics were not overridden with role=\"none\" or role=\"presentation\""
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "critical",
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ],
                                "failureSummary": "Fix any of the following:\n  Form element does not have an implicit (wrapped) <label>\n  Form element does not have an explicit <label>\n  aria-label attribute does not exist or is empty\n  aria-labelledby attribute does not exist, references elements that do not exist or references elements that are empty\n  Element has no title attribute\n  Element has no placeholder attribute\n  Element's default semantics were not overridden with role=\"none\" or role=\"presentation\""
                              }
                            ]
                          },
                          {
                            "id": "landmark-one-main",
                            "impact": "moderate",
                            "tags": [
                              "cat.semantics",
                              "best-practice"
                            ],
                            "description": "Ensures the document has a main landmark",
                            "help": "Document should have one main landmark",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/landmark-one-main?application=axeAPI",
                            "nodes": [
                              {
                                "any": [],
                                "all": [
                                  {
                                    "id": "page-has-main",
                                    "data": null,
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Document does not have a main landmark"
                                  }
                                ],
                                "none": [],
                                "impact": "moderate",
                                "html": "<html>",
                                "target": [
                                  "html"
                                ],
                                "failureSummary": "Fix all of the following:\n  Document does not have a main landmark"
                              }
                            ]
                          },
                          {
                            "id": "region",
                            "impact": "moderate",
                            "tags": [
                              "cat.keyboard",
                              "best-practice"
                            ],
                            "description": "Ensures all page content is contained by landmarks",
                            "help": "All page content should be contained by landmarks",
                            "helpUrl": "https://dequeuniversity.com/rules/axe/4.6/region?application=axeAPI",
                            "nodes": [
                              {
                                "any": [
                                  {
                                    "id": "region",
                                    "data": {
                                      "isIframe": false
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Some page content is not contained by landmarks"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "moderate",
                                "html": "<h1>Upload form</h1>",
                                "target": [
                                  "h1"
                                ],
                                "failureSummary": "Fix any of the following:\n  Some page content is not contained by landmarks"
                              },
                              {
                                "any": [
                                  {
                                    "id": "region",
                                    "data": {
                                      "isIframe": false
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Some page content is not contained by landmarks"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "moderate",
                                "html": "<label for=\"upload\">upload</label>",
                                "target": [
                                  "label"
                                ],
                                "failureSummary": "Fix any of the following:\n  Some page content is not contained by landmarks"
                              },
                              {
                                "any": [
                                  {
                                    "id": "region",
                                    "data": {
                                      "isIframe": false
                                    },
                                    "relatedNodes": [],
                                    "impact": "moderate",
                                    "message": "Some page content is not contained by landmarks"
                                  }
                                ],
                                "all": [],
                                "none": [],
                                "impact": "moderate",
                                "html": "<input type=\"file\" name=\"upload\" id=\"upload-chooser\" required=\"required\">",
                                "target": [
                                  "#upload-chooser"
                                ],
                                "failureSummary": "Fix any of the following:\n  Some page content is not contained by landmarks"
                              }
                            ]
                          }
                        ]
                      },
                      "res": {
                        "ok": false,
                        "acceptable": {
                          "serious": 0,
                          "moderate": 0
                        },
                        "found": {
                          "serious": 2,
                          "moderate": 2
                        }
                      }
                    }
                  }
                },
                "name": "checkA11yRuntime",
                "start": 0.54810763,
                "end": 0.680990312
              }
            ],
            "seq": 5
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "endFeature WebPlaywright",
      "level": "debug",
      "caller": "Executor:154:27"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "closing WebPlaywright",
      "level": "debug",
      "caller": "Executor:170:27"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "closing WebServerStepper",
      "level": "debug",
      "caller": "Executor:170:27"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "closing server 8123",
      "level": "info",
      "caller": "server-express:127:17"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "closing TestRoute",
      "level": "debug",
      "caller": "Executor:170:27"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "███ feature 2: /features/a11y-pass.feature",
      "level": "log",
      "caller": "Executor:88:18"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Feature: Test accessibility\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 0,
          "result": {
            "ok": true,
            "in": "Feature: Test accessibility",
            "sourcePath": "/features/a11y-pass.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "feature",
                "start": 0.792363817,
                "end": 0.792375367
              }
            ],
            "seq": 1
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Set test to http://localhost:8123/a11y.html\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 1,
          "result": {
            "ok": true,
            "in": "Set test to http://localhost:8123/a11y.html",
            "sourcePath": "/backgrounds/int/a11y.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "set",
                "start": 0.792610787,
                "end": 0.792631476
              }
            ],
            "seq": 2
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Serve files from \"a11y\"\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "serving files from /home/vid/D/withhaibun/haibun-e2e-tests/files/a11y at /",
      "level": "info",
      "caller": "server-express:111:17"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Server listening on port: 8123",
      "level": "log",
      "caller": "server-express:39:25"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "express listening",
      "level": "log",
      "caller": "server-express:41:25"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 2,
          "result": {
            "ok": true,
            "in": "Serve files from \"a11y\"",
            "sourcePath": "/features/a11y-pass.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "serveFiles",
                "start": 0.792862246,
                "end": 0.793462976
              }
            ],
            "seq": 3
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "Go to the test webpage\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "creating new page for 0",
      "level": "info",
      "caller": "BrowserFactory:137:17"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "creating new context 0 chromium",
      "level": "info",
      "caller": "BrowserFactory:84:21"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 3,
          "result": {
            "ok": true,
            "in": "Go to the test webpage",
            "sourcePath": "/features/a11y-pass.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "gotoPage",
                "start": 0.793717515,
                "end": 0.915038199
              }
            ],
            "seq": 4
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "page is accessible accepting serious 9 and moderate 9\r",
      "level": "log",
      "caller": "Executor:94:20"
    },
    {
      "messageContext": {
        "topic": {
          "stage": "Executor",
          "seq": 4,
          "result": {
            "ok": true,
            "in": "page is accessible accepting serious 9 and moderate 9",
            "sourcePath": "/features/a11y-pass.feature",
            "actionResults": [
              {
                "ok": true,
                "name": "checkA11yRuntime",
                "start": 0.915358269,
                "end": 1.03997946
              }
            ],
            "seq": 5
          }
        },
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "✅",
      "level": "log",
      "caller": "Executor:104:20"
    },
    {
      "messageContext": {
        "tag": {
          "key": "__test",
          "sequence": 0,
          "loop": 1,
          "member": 0,
          "featureNum": 1,
          "params": {
            "test": "http://localhost:8123/a11y.html",
            "http://localhost:8123/a11y.html": "http://localhost:8123/a11y.html",
            "_scored": [],
            "feature": "Test accessibility"
          },
          "trace": true
        }
      },
      "message": "endFeature WebPlaywright",
      "level": "debug",
      "caller": "Executor:154:27"
    }
  ]
}