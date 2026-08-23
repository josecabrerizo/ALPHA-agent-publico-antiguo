/**
 * En un servidor MCP por stdio, stdout ES el protocolo: cualquier console.log
 * de un modulo importado (el engine, por ejemplo, avisa por consola de YAML
 * invalido) meteria texto suelto entre los mensajes JSON-RPC y romperia la
 * conexion con el agente.
 *
 * Este modulo se importa el PRIMERO (los imports de ESM se ejecutan en orden)
 * y desvia a stderr todo lo que en Node sale por stdout.
 */
console.log = console.error.bind(console);
console.info = console.error.bind(console);
console.debug = console.error.bind(console);

export {};
