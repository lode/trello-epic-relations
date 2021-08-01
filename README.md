# Trello EPIC relations

![Search dropdown to add a task on the back of a Trello card](/adding-a-task.png)

![Back of a Trello card with an indication of the number of (completed) tasks below the title](/top-of-epic.png)
![Back of a Trello card with an link to the epic card below the title](/top-of-task.png)

This power-up for Trello allows to quickly connect project cards (epics) to task cards.
It works with native checklists and card attachments, so your data is yours even when you don't use the plugin.

Currently, you can't manually add/remove tasks in a checklist of an epic card or remove an epic card attachment of a task card.


## Install

The power-up isn't published/listed yet. You'll need to install it as a custom power-up until then.

- Go to https://trello.com/power-ups/admin and click 'Create new Power-Up' the top right.
- Fill:
	- Name: `EPIC relations`
	- Workspace: the workspace you want to use the power-up in (you'll need to be an admin of that workspace).
	- Iframe-connector-URL: `https://www.lodeclaassen.nl/trello-epic-relations/power-up/`
- If this is your first time using a custom power-up, you'll need to agree to a 'Joint Developer Agreement' first.
- On the baic information tab, fill:
	- Symbol: `https://www.lodeclaassen.nl/trello-epic-relations/power-up/favicon.png`
- On the permissions tab, enable:
	- `card-badges`
	- `card-buttons`
	- `card-detail-badges`
	- `authorization-status`
	- `show-authorization`
- Go to the board where you want to use it and open the power-ups marketplace overlay.
- Click on the 'custom' section on the left, and add 'EPIC relations'.


## First time use

Every person using the power-up will need to authorize against the Trello API.
From the power-up in the board menu, choose 'Authorize' and complete the steps.

Currently the power-up needs write access from your account.
This is needed as it stores the relations in checklists and card attachments, and that needs write access from your account.

When not authorized, you can still see the relations and navigate between them, but you can't change them.


## Usage

To **add a task to an epic**, open an epic card and click the 'task' card button on the right.

To **add set the epic of a task**, open a task card and click the 'epic' card button on the right.

To **remove a relation**, open _the task card_, click the 'epic' card button on the right, and choose the last option to remove the epic.

Note, every add/remove action is automatically synced to the related card.
This works across boards within the same organization as well. Even if those boards don't have the plugin installed.

Be aware that **you can't (yet) manually change the checklist or card attachment**. Always use the card buttons to do so.
You can sort card attachments or checklists, rename checklists, or update checkitems (marking (in)complete, attaching people and due dates).


## Contributing

If you use the power-up, please ask questions or share what can be improved by [creating an issue](https://github.com/lode/trello-epic-relations/issues).

For bugs [issues](https://github.com/lode/trello-epic-relations/issues) or [Pull Requests](https://github.com/lode/trello-epic-relations/pulls) are welcome!

To develop improvements there is a [Glitch](https://glitch.com/edit/#!/trello-epic-relations) which you can remix.


## Licence

[MIT](/LICENSE)
