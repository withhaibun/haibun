export default class Block {
  _lines: any[]
  _frameId: any
  constructor(frameId: number, line: any = undefined) {
    this._lines = []
    this._frameId = frameId

    if (line) {
      line.frameId = this._frameId
      this._lines.push(line)
    }
  }

  addLineToTop(line: any) {
    line.frameId = this._frameId
    this._lines.unshift(line)
  }

  addLine(line: any) {
    line.frameId = this._frameId
    this._lines.push(line)
  }

  getLines() {
    return this._lines
  }
}
