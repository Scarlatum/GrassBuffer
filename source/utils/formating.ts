import { tempDegradation } from "./common.ts";

function randomSeq() {

  const arr = Array.from({ length: 12 }, () => {
    return Math.floor(Math.random() * 255)
      .toString(16)
      .padStart(2,"0")
  });

  return arr.join("|");

}

function textFade(text: string) {

  const begin = Math.floor(text.length * Math.random() * 0.25);
  const end   = text.length - Math.floor(text.length * Math.random() * 0.25);

  return text.slice(begin, end)
    .trim()
    .split("")
    .map((x,i, a) => {
      return tempDegradation(i / a.length) 
        ? x === " " ? x : "•" 
        : x
    })
    .join("");
    
}

export function transmission(text: string) {

  const timestamp = performance.now();
  const uuid      = crypto.randomUUID();

  const padding = (x: string) => x.padStart(uuid.length, " ");

  const result = `
  TR :: ${ padding(crypto.randomUUID()) } ::
  EV :: ${ padding(String(performance.now() - timestamp)) } ::
  SQ :: ${ padding(randomSeq()) } ::
  LN :: ${ padding(text.length.toString(16).padStart(4,"0")) } ::

  --- TRANSACTION BEGIN ---
  •••${ textFade(text) }•••
  --- TRANSACTION END ---
`.trim();

  return result;

}