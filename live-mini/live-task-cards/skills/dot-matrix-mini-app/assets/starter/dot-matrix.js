/* Generic Canvas display. No character geometry, video, image, or eye drawing. */
'use strict';
class DotMatrix {
  constructor(canvas, { columns, rows, radius = 0.35, off = 25, on = 255, background = '#070c14' }) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: false });
    this.columns = columns; this.rows = rows; this.radius = radius;
    this.off = off; this.on = on; this.background = background;
  }
  configure(columns, rows) { this.columns = columns; this.rows = rows; }
  render(intensities) {
    if (intensities.length !== this.columns * this.rows) throw new RangeError('One intensity per matrix cell is required.');
    const {canvas, context: ctx, columns, rows} = this;
    const width = canvas.clientWidth || 640, height = canvas.clientHeight || 480;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle=this.background; ctx.fillRect(0,0,width,height);
    const pitch = Math.min(width/columns,height/rows);
    const left=(width-columns*pitch)/2,top=(height-rows*pitch)/2;
    for (let row=0;row<rows;row++) for(let col=0;col<columns;col++) {
      const intensity=Math.max(0,Math.min(1,intensities[row*columns+col]));
      const luminance=Math.round(this.off+(this.on-this.off)*intensity);
      ctx.fillStyle=`rgb(${luminance} ${luminance} ${luminance})`;
      ctx.beginPath();ctx.arc(left+(col+.5)*pitch,top+(row+.5)*pitch,pitch*this.radius,0,Math.PI*2);ctx.fill();
    }
  }
}
window.DotMatrix=DotMatrix;
