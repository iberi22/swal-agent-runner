/**
 * Generador QR minimo para la PWA.
 * Muestra el peer ID como texto via API publica de QR code externa.
 * No requiere dependencias adicionales.
 */
export function getQRDataUrl(text: string, size: number = 200): string {
  // Usar API publica de QR sin dependencias
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}
