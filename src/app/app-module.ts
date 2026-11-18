import {
  NgModule,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { App } from './app';
import { JsonEditorComponent } from './components/json-editor/json-editor.component';
import { JsonTreeComponent } from './components/json-tree/json-tree.component';
import { JsonTreeNodeComponent } from './components/json-tree-node/json-tree-node.component';
import { CommandPaletteComponent } from './components/command-palette/command-palette.component';
import { JsonTableComponent } from './components/json-table/json-table.component';
import { SaveDialogComponent } from './components/save-dialog/save-dialog.component';
import { FilesPanelComponent } from './components/files-panel/files-panel.component';
import { AppHeaderComponent } from './components/app-header/app-header.component';
import { CompareBarComponent } from './components/compare-bar/compare-bar.component';

import { inject } from "@vercel/analytics"
inject();

@NgModule({
  declarations: [
    App,
    JsonEditorComponent,
    JsonTreeComponent,
    JsonTreeNodeComponent,
    CommandPaletteComponent,
    JsonTableComponent,
    SaveDialogComponent,
    FilesPanelComponent,
    AppHeaderComponent,
    CompareBarComponent,
  ],
  imports: [
    BrowserModule,
    FormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDividerModule,
    MatMenuModule,
    MatBadgeModule,
    ScrollingModule,
  ],
  providers: [
    provideBrowserGlobalErrorListeners(),
    // No zone.js: rendering is driven by signals, template events and markForCheck().
    provideZonelessChangeDetection(),
  ],
  bootstrap: [App]
})
export class AppModule { }
