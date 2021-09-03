import App from "./components/App";

const controls = {
  input: `<input />`,
  "submit button": `<input type="submit" />`,
};

export default class WebComponentBuilder {
  all = [];
  constructor() {}
  add(control) {
    if (controls[control]) {
      // this.all.push(controls[control]);
    }
    return control;
  }
  async render() {
        // const result = await renderToStringAsync(() => <App url={'http://localhost:8123/localInterface.html'} />);

  }
}
