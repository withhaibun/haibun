import { html, TemplateResult } from 'lit';
import '../src/app-shell.js';

export default {
  title: 'AppShell',
  component: 'app-shell',
  argTypes: {
    backgroundColor: { control: 'color' },
  },
};

interface Story<T> {
  (args: T): TemplateResult;
  args?: Partial<T>;
  argTypes?: Record<string, unknown>;
}

interface ArgTypes {
  title?: string;
  backgroundColor?: string;
}

const Template: Story<ArgTypes> = ({ title, backgroundColor = 'white' }: ArgTypes) => html`
  <app-shell style="--app-shell-background-color: ${backgroundColor}" .title=${title}></app-shell>
`;

export const App = Template.bind({});
App.args = {
  title: 'My app',
};
