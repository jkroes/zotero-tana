import { FluentMessageId } from '../../locale/fluent-types';

/** One item whose sync left referenced fields untouched (see sync-regular-item). */
export type ItemWarning = { item: Zotero.Item; fields: string[] };

export class ProgressWindow {
  private readonly itemCount: number;
  private itemProgress!: Zotero.ProgressWindow.ItemProgress;
  private readonly l10n: L10n.Localization<FluentMessageId>;
  private readonly progressWindow: Zotero.ProgressWindow;

  public constructor(itemCount: number, window: Window) {
    this.itemCount = itemCount;
    this.l10n = window.document.l10n;
    this.progressWindow = new Zotero.ProgressWindow({ window });
  }

  public async show() {
    const headline = await this.l10n.formatValue('zotana-progress-headline');
    this.progressWindow.changeHeadline(headline || 'Syncing items to Tana…');
    this.progressWindow.show();
    this.itemProgress = new this.progressWindow.ItemProgress('document', '');
  }

  public async updateText(step: number) {
    const args = { step, total: this.itemCount };
    const message =
      (await this.l10n.formatValue('zotana-progress-item', args)) ||
      `Item ${step} of ${this.itemCount}`;
    this.itemProgress.setText(message);
  }

  public updateProgress(step: number) {
    const percentage = (step / this.itemCount) * 100;
    this.itemProgress.setProgress(percentage);
  }

  public async complete(warnings: ItemWarning[] = []) {
    if (!warnings.length) {
      this.progressWindow.startCloseTimer();
      return;
    }

    // Referenced fields were left unchanged. Surface them and keep the window
    // open (no close timer) so the user notices and can resolve them in Tana.
    const headline = await this.l10n.formatValue('zotana-warning-headline');
    this.progressWindow.changeHeadline(headline || 'Synced with warnings');

    for (const { item, fields } of warnings) {
      new this.progressWindow.ItemProgress(
        item.itemType,
        item.getDisplayTitle(),
        this.itemProgress,
      ).setProgress(100);

      const message =
        (await this.l10n.formatValue('zotana-warning-referenced-fields', {
          fields: fields.join(', '),
        })) || `Referenced in Tana, not updated: ${fields.join(', ')}`;
      void new this.progressWindow.ItemProgress('', message);
    }
  }

  public fail(errorMessage: string, failedItem?: Zotero.Item) {
    if (failedItem) {
      new this.progressWindow.ItemProgress(
        failedItem.itemType,
        failedItem.getDisplayTitle(),
        this.itemProgress,
      ).setProgress(100);
      new this.progressWindow.ItemProgress('', errorMessage).setError();
    } else {
      this.itemProgress.setError();
      this.itemProgress.setText(errorMessage);
      this.progressWindow.addDescription(''); // Hack to force window resize
    }
  }
}
