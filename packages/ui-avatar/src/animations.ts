/**
 * Animaciones del retrato del avatar según el estado de la conversación.
 * El retrato es una imagen estática, así que se anima como un todo (escala,
 * rotación, opacidad, glow) en lugar de animar partes individuales.
 */
import type { AvatarState } from './states.js';

/** Estilos de animación CSS para cada estado. */
export const ANIMATIONS: Record<AvatarState | 'reposo', string> = {
  reposo: `
    animation: idle 4s ease-in-out infinite;
  `,
  escuchando: `
    animation: listening 0.8s ease-in-out infinite;
  `,
  pensando: `
    animation: thinking 2s ease-in-out infinite;
  `,
  hablando: `
    animation: speaking 0.4s ease-in-out infinite;
  `,
};

/** Definiciones CSS de las keyframes. */
export const KEYFRAMES = `
@keyframes idle {
  0%, 100% {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
  50% {
    transform: scale(1.02) translateY(-2px);
    opacity: 0.95;
  }
}

@keyframes listening {
  0%, 100% {
    transform: scale(1) rotateZ(0deg);
    filter: brightness(1);
  }
  25% {
    transform: scale(1.05) rotateZ(-1deg);
    filter: brightness(1.1);
  }
  50% {
    transform: scale(1.05) rotateZ(1deg);
    filter: brightness(1);
  }
  75% {
    transform: scale(1.05) rotateZ(-1deg);
    filter: brightness(1.1);
  }
}

@keyframes thinking {
  0%, 100% {
    transform: scale(1) rotateZ(0deg);
    filter: hue-rotate(0deg);
  }
  25% {
    transform: scale(0.98) rotateZ(-0.5deg);
    filter: hue-rotate(-5deg);
  }
  50% {
    transform: scale(0.98) rotateZ(0.5deg);
    filter: hue-rotate(5deg);
  }
  75% {
    transform: scale(0.98) rotateZ(-0.5deg);
    filter: hue-rotate(-5deg);
  }
}

@keyframes speaking {
  0%, 100% {
    transform: scale(1) scaleY(1);
  }
  50% {
    transform: scale(1.03) scaleY(1.05);
  }
}
`;
