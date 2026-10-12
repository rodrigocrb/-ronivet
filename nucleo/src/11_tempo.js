/* Datas e horas locais da clínica, sem fuso: textos AAAA-MM-DD e AAAA-MM-DDTHH:MM.
 * Toda aritmética usa Date.UTC, para não sofrer com horário de verão do ambiente. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  const FORMATO_INICIO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
  const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

  const pad = (n, t = 2) => String(n).padStart(t, "0");

  function dataValida(texto) {
    const m = FORMATO_DATA.exec(String(texto || ""));
    if (!m) return false;
    const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(a, me - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d;
  }

  /** 0 = domingo ... 6 = sábado. */
  function diaSemana(isoData) {
    const [a, m, d] = isoData.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  }

  function horaEmMinutos(hhmm) {
    const [h, m] = hhmm.split(":");
    return Number(h) * 60 + Number(m);
  }

  /** Minutos desde 1970 de um AAAA-MM-DDTHH:MM (suficiente para comparar intervalos). */
  function emMinutos(inicio) {
    const m = FORMATO_INICIO.exec(inicio);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
  }

  function dePartes(minutosEpoch) {
    const dt = new Date(minutosEpoch * 60000);
    return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
      + `T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
  }

  function somarMinutos(inicio, minutos) {
    return dePartes(emMinutos(inicio) + minutos);
  }

  /** AAAA-MM-DDTHH:MM válido (inclusive calendário) ou lança 422. */
  function parseInicio(texto) {
    if (!FORMATO_INICIO.test(String(texto || ""))) {
      throw R.erro(422, "início deve ser AAAA-MM-DDTHH:MM");
    }
    if (!dataValida(texto.slice(0, 10))) throw R.erro(422, "data/hora inválida");
    return texto;
  }

  function somarDias(isoData, n) {
    const [a, m, d] = isoData.split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d + n));
    return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function somarMeses(isoData, meses) {
    const [a, m, d] = isoData.split("-").map(Number);
    const indice = a * 12 + (m - 1) + meses;
    const ano = Math.floor(indice / 12);
    const mes = (indice % 12) + 1;
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${pad(ano, 4)}-${pad(mes)}-${pad(Math.min(d, ultimo))}`;
  }

  /** "2026-10-12" -> "12/10/2026". */
  function dataBR(isoData) {
    const [a, m, d] = isoData.split("-");
    return `${d}/${m}/${a}`;
  }

  R.tempo = {
    FORMATO_HORA, dataValida, diaSemana, horaEmMinutos, emMinutos, somarMinutos, parseInicio,
    somarDias, somarMeses, dataBR,
  };
})(RoniVet);
