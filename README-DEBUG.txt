IRCTC AutoFill Debug Version

This version keeps passenger autofill and payment-mode selection, but it does NOT automatically click Continue/Confirm buttons.

What it changes:
- Detects review/preview pages more flexibly.
- Detects visible Continue buttons using text, value, aria-label, title, role, and submit/button elements.
- Highlights detected Continue buttons with a red outline.
- Logs detection details in the browser DevTools console.
- Uses a MutationObserver so dynamically rendered buttons can be detected.

To test:
1. Open chrome://extensions
2. Enable Developer mode.
3. Remove/disable the old extension.
4. Load the folder containing manifest.json using Load unpacked.
5. Open the extension and use the autofill feature.
6. Open DevTools Console and look for messages beginning with [IRCTC AutoFill].
7. On the review/preview page, the detected Continue button will have a red outline.
8. Click the button manually.
