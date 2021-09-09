import '@vaadin/vaadin-grid';
import '@vaadin/vaadin-split-layout';
import '@vaadin/vaadin-app-layout';
import '@vaadin/vaadin-upload';
import '@vaadin/vaadin-ordered-layout';

import './log-message';
import './log-messages';
import './topic-result';
import './topic-results';
import './message-processor';

const upload = document.querySelector('vaadin-upload');
(upload as any).set('i18n.addFiles.many', 'Select SCTM files');
