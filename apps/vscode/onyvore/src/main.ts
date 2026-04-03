import 'reflect-metadata';
import { createExtensionFromModule } from '@onivoro/server-vscode';
import { OnyvoreExtensionModule } from './app/onyvore-extension.module';

export const { activate, deactivate } = createExtensionFromModule(
  OnyvoreExtensionModule,
);
