# Fonts

Self-hosted so the app makes no request to Google. Both families are licensed under the SIL Open
Font License 1.1.

- `inter-latin-{300,400,500}.woff2`: Inter, Latin subset, from `@fontsource/inter` 5.3.0.
- `material-icons-subset.woff2`: Material Icons reduced to the icons the app uses, from
  `@fontsource/material-icons` 5.3.0.

## Adding an icon

The icon font only contains the icons listed below, so a new `<mat-icon>` name shows as plain text
until it is added. Re-create the subset from the full font (install the npm package into a scratch
folder, not the project) with fontTools: keep only these ligatures in the `rlig` feature, then
subset to the letters in their names and save as WOFF2.

account_tree add arrow_downward arrow_upward bolt cancel casino check_circle chevron_right clear
close code compare_arrows compress content_copy content_paste dark_mode data_object delete_outline
download drive_file_rename_outline edit error_outline filter_list folder_open format_align_left
hourglass_empty inbox info insert_drive_file keyboard_arrow_down keyboard_arrow_up light_mode link
rule save search sort_by_alpha swap_horiz table_chart unfold_less unfold_more upload_file
view_column visibility_off
