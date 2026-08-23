import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Reglas de A.L.P.H.A.
 *
 * El criterio: las reglas que se quedan en "error" son las que corresponden a
 * fallos que este proyecto YA ha tenido (promesas sin esperar, turnos que se
 * pisan, `catch` que se traga un error). Las que solo cambian el aspecto se
 * apagan y las decide Prettier; y la familia `no-unsafe-*` se apaga porque aqui
 * lo que entra de fuera (JSON del puente, YAML de configuracion) se recibe como
 * `unknown` y se estrecha a mano a proposito — marcarlo seria ruido sobre codigo
 * que hace justo lo correcto.
 */
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'vendor/**', 'models/**', '**/*.d.ts'],
  },

  // JavaScript suelto (lanzadores y utilidades): sin tipos, solo lo basico.
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    rules: {
      ...js.configs.recommended.rules,
      // Son scripts de Node: `process`, `console` y compania existen. Sin el
      // paquete `globals` no hay lista fiable, y para .mjs la regla aporta poco.
      'no-undef': 'off',
    },
  },

  // TypeScript con tipos. Los proyectos son los de comprobar (tsconfig.check),
  // que SI incluyen los tests: sin ellos el lint no vería la mitad del codigo
  // donde viven las carreras.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['packages/*/src/**/*.ts'],
  })),
  {
    files: ['packages/*/src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: [
          './packages/protocol/tsconfig.check.json',
          './packages/engine/tsconfig.check.json',
          './packages/ui-avatar/tsconfig.check.json',
          './packages/avatar-mcp/tsconfig.check.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Las que de verdad cazan bugs aqui: una promesa suelta es un turno que
      // nadie espera, y ya nos costo una carrera entre STT y chat escrito.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          // `test()` de node:test devuelve una promesa que NO se espera a
          // proposito: la espera el runner. Se exceptua por nombre en vez de
          // apagar la regla en los tests, que es donde mas falta hace.
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['test', 'it', 'describe'] },
          ],
        },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Un metodo `async` sin `await` no es un error: es como se implementa una
      // interfaz asincrona (Speaker.speak) con algo que resuelve al momento.
      '@typescript-eslint/require-await': 'off',

      // Lo que entra por el puente o del YAML es `unknown` y se valida a mano.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // Interpolar numeros en plantillas es normal en los logs de latencias.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],

      // Un argumento con `_` delante esta ahi por la firma, no por descuido.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // Los `catch {}` vacios de este codigo son deliberados y llevan comentario
      // explicando por que; la regla no sabe leerlos.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    files: ['packages/ui-avatar/src/**/*.ts'],
    rules: {
      // Los enums de NodeGui (MouseButton y compania) no los reconoce la regla
      // como "el mismo enum" que el que devuelven sus propios metodos, asi que
      // marca comparaciones correctas. Y castearlos para callarla dispara a su
      // vez no-unnecessary-type-assertion, porque para TypeScript el tipo YA es
      // el bueno. Es un artefacto del tipado de la libreria, no de este codigo.
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    },
  },

  // Prettier al final: apaga todo lo que sea cuestion de aspecto.
  prettier,
);
