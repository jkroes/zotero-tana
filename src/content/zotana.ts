import type { PluginInfo } from './plugin-info';
import {
  EventManager,
  PreferencePaneManager,
  Service,
  ServiceParams,
  SyncManager,
  UIManager,
} from './services';
import { logger } from './utils';

export class Zotana {
  public readonly eventManager: EventManager;

  private readonly preferencePaneManager: PreferencePaneManager;
  private readonly services: Service[];

  public constructor() {
    this.eventManager = new EventManager();
    this.preferencePaneManager = new PreferencePaneManager();

    this.services = [
      this.eventManager,
      this.preferencePaneManager,
      new SyncManager(),
      new UIManager(),
    ];
  }

  public async startup(pluginInfo: PluginInfo) {
    await Zotero.uiReadyPromise;

    await this.startServices(pluginInfo);
    this.addToAllWindows();
  }

  public shutdown() {
    this.removeFromAllWindows();
    this.shutDownServices();
  }

  private async startServices(pluginInfo: PluginInfo) {
    const dependencies: ServiceParams['dependencies'] = {
      eventManager: this.eventManager,
      preferencePaneManager: this.preferencePaneManager,
    };

    logger.groupCollapsed('Starting services');
    for (const service of this.services) {
      const serviceName = service.constructor.name;
      try {
        logger.log(`Starting ${serviceName}`);
        await service.startup({ dependencies, pluginInfo });
      } catch (error) {
        logger.error(`Failed to start ${serviceName}:`, error);
      }
    }
    logger.groupEnd();
  }

  private shutDownServices() {
    logger.groupCollapsed('Shutting down services');
    this.services.toReversed().forEach((service) => {
      if (!service.shutdown) return;
      logger.log(`Shutting down ${service.constructor.name}`);
      service.shutdown();
    });
    logger.groupEnd();
  }

  private addToAllWindows() {
    Zotero.getMainWindows().forEach((window) => {
      if (!window.ZoteroPane) return;
      this.addToWindow(window);
    });
  }

  public addToWindow(window: Zotero.ZoteroWindow) {
    logger.groupCollapsed('Adding services to window');
    this.services.forEach((service) => {
      if (!service.addToWindow) return;
      logger.log(`Adding ${service.constructor.name} to window`);
      service.addToWindow(window);
    });
    logger.groupEnd();
  }

  private removeFromAllWindows() {
    Zotero.getMainWindows().forEach((window) => {
      if (!window.ZoteroPane) return;
      this.removeFromWindow(window);
    });
  }

  public removeFromWindow(window: Zotero.ZoteroWindow) {
    logger.groupCollapsed('Removing services from window');
    this.services.forEach((service) => {
      if (!service.removeFromWindow) return;
      logger.log(`Removing ${service.constructor.name} from window`);
      service.removeFromWindow(window);
    });
    logger.groupEnd();
  }
}

export type ZoteroWithZotana = Zotero & { Zotana?: Zotana };

(Zotero as ZoteroWithZotana).Zotana = new Zotana();
