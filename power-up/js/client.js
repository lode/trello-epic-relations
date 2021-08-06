/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

const CDN_BASE_URL = document.getElementById('js-cdn-base-url').href;
const FAVICON      = CDN_BASE_URL + 'favicon.png';
const ICON_UP      = CDN_BASE_URL + 'icon-up.png';
const ICON_DOWN    = CDN_BASE_URL + 'icon-down.png';
const LIST_MAXIMUM = 10;
const SHOW_DEBUG   = false;

/**
 * @param  {string}           cardUrl
 * @return {string|undefined} shortLink
 */
function getCardShortLinkFromUrl(cardUrl) {
	const matches = cardUrl.match(/^https:\/\/trello\.com\/c\/([^/]+)(\/|$)/);
	if (matches === null) {
		return undefined;
	}
	
	const shortLink = matches[1];
	
	return shortLink;
}

/**
 * @param  {object} t                 without context
 * @param  {string} cardIdOrShortLink
 * @return {Promise} => {object} card {
 *         @var {string} id
 *         @var {string} name
 *         @var {string} url
 *         @var {string} shortLink
 *         @var {string} idBoard
 * }
 */
async function getCardByIdOrShortLink(t, cardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=id,name,url,shortLink,idBoard', {}, null, function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		return {
			id:        response.id,
			name:      response.name,
			url:       response.url,
			shortLink: response.shortLink,
			idBoard:   response.idBoard,
		};
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * get plugin data from another card when you don't know whether that card is in context or not
 * 
 * @param  {object} t                 without context
 * @param  {string} cardIdOrShortLink
 * @param  {string} parentOrChildren  'parent' or 'children'
 * @return {Promise} => {object|undefined} pluginData
 */
async function getPluginData(t, cardIdOrShortLink, parentOrChildren) {
	try {
		const pluginDataWithinContext = await t.get(cardIdOrShortLink, 'shared', parentOrChildren);
		if (pluginDataWithinContext !== undefined) {
			return pluginDataWithinContext;
		}
		
		// fall-through to get plugin data via API
	}
	catch (error) {
		// supress expected error for cards on other boards
		if (error.message === undefined || error.message !== 'Card not found or not on current board (Command: data)') {
			console.warn('Error while fetching card plugin data', error);
		}
		
		// fall-through to get plugin data via API
	}
	
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=&pluginData=true');
		if (response.pluginData.length === 0) {
			return;
		}
		
		const pluginData = response.pluginData.find(function(pluginData) {
			return (JSON.parse(pluginData.value)[parentOrChildren] !== undefined);
		});
		if (pluginData === undefined) {
			return;
		}
		
		return JSON.parse(pluginData.value)[parentOrChildren];
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
		
		return;
	}
}

/**
 * @param  {object} t                       without context
 * @param  {string} parentCardIdOrShortLink
 * @return {Promise} => {object[]} checklists
 */
async function getChecklists(t, parentCardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + parentCardIdOrShortLink + '?fields=&checklists=all&checklist_fields=all');
		
		return response.checklists;
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
		
		return;
	}
}

/**
 * @param  {object} t           without context
 * @param  {string} checklistId
 * @return {Promise} => {object[]} checkItems
 */
function getCheckItems(t, checklistId) {
	try {
		return window.Trello.get('checklists/' + checklistId + '/checkItems?fields=name,state', {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * get parentData when the relations have changed
 * 
 * @param  {object}             t context
 * @return {object}             newData {
 *         @var {object|undefined} parentCard {
 *              @var {string} id
 *              @var {string} name
 *              @var {string} url
 *              @var {string} shortLink
 *              @var {string} idBoard
 *         }
 *         @var {object|undefined} attachment {
 *              @var {string} id
 *         }
 * }
 */
async function getSyncParentData(t) {
	const attachments = await t.card('attachments').then(function(card) {
		return card.attachments;
	});
	
	let newData = {
		parentCard: undefined,
		attachment: undefined,
	};
	
	if (attachments.length === 0) {
		return newData;
	}
	
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	const childShortLink = await t.card('shortLink').then(function(card) {
		return card.shortLink;
	})
	
	let parentShortLink;
	let childrenOfParent;
	let parentCard;
	
	for (let attachment of attachments) {
		parentShortLink = getCardShortLinkFromUrl(attachment.url);
		if (parentShortLink === undefined) {
			continue;
		}
		
		childrenOfParent = await getPluginData(t, parentShortLink, 'children');
		if (childrenOfParent === undefined) {
			continue;
		}
		if (childrenOfParent.shortLinks.includes(childShortLink) === false) {
			continue;
		}
		
		parentCard = await getCardByIdOrShortLink(t, parentShortLink);
		
		newData.parentCard = parentCard;
		newData.attachment = attachment;
		break;
	}
	
	return newData;
}

/**
 * get counts for childrenData when the checklist has changed
 * 
 * @param  {object} t           without context
 * @param  {object} currentData {
 *         @var {string} checklistId
 * }
 * @return {object} newCounts {
 *         @var {int} total
 *         @var {int} done
 * }
 */
async function getChildrenCountData(t, currentData) {
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	const checkItems = await getCheckItems(t, currentData.checklistId);
	let newCounts = {
		total: 0,
		done:  0,
	};
	
	for (let checkItem of checkItems) {
		newCounts.total += 1;
		if (checkItem.state === 'complete') {
			newCounts.done += 1;
		}
	}
	
	return newCounts;
}

/**
 * get childrenData when the relations have changed
 * 
 * @param  {object}           t               context
 * @param  {string}           parentShortLink
 * @param  {object|undefined} currentData {
 *         @var {string} checklistId
 * }
 * @return {object}           newData {
 *         @var {string}   checklistId
 *         @var {string[]} shortLinks
 *         @var {object}   checkItemIds map of shortLinks to checkItemIds
 *         @var {object}   counts {
 *              @var {int} total
 *              @var {int} done
 *         }
 * }
 */
async function getSyncChildrenData(t, parentShortLink, currentData) {
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		throw new Error('not authorized to sync');
	}
	
	if (currentData !== undefined) {
		const checkItems = await getCheckItems(t, currentData.checklistId);
		const newData    = await collectChildrenDataToSync(t, currentData.checklistId, checkItems, parentShortLink, currentData);
		if (JSON.stringify(newData) === JSON.stringify(currentData)) {
			throw new Error('nothing changed to sync');
		}
		
		return newData;
	}
	else {
		const checklists = await getChecklists(t, parentShortLink);
		if (checklists.length === 0) {
			throw new Error('no checklists to sync');
		}
		
		let newData;
		for (let checklist of checklists) {
			newData = await collectChildrenDataToSync(t, checklist.id, checklist.checkItems, parentShortLink, currentData);
			if (newData.shortLinks.length === 0) {
				continue;
			}
			
			return newData;
		}
		
		// default to any checklist found without items
		return newData;
	}
}

/**
 * @param  {object}           t               without context
 * @param  {string}           checklistId
 * @param  {object[]}         checkItems {
 *         @var {string} id
 *         @var {string} name
 *         @var {string} state 'incomplete' or 'complete'
 * }
 * @param  {string}           parentShortLink
 * @param  {object|undefined} currentData
 * @return {object}           newData {
 *         @var {string}   checklistId
 *         @var {string[]} shortLinks
 *         @var {object}   checkItemIds map of shortLinks to checkItemIds
 *         @var {object}   counts {
 *              @var {int} total
 *              @var {int} done
 *         }
 * }
 */
async function collectChildrenDataToSync(t, checklistId, checkItems, parentShortLink, currentData) {
	let newData = {
		checklistId:  checklistId,
		shortLinks:   [],
		checkItemIds: {},
		counts:       {total: 0, done: 0},
	};
	
	if (checkItems.length === 0 && currentData === undefined) {
		return newData;
	}
	
	let childShortLink;
	let parentOfChild;
	
	for (let checkItem of checkItems) {
		childShortLink = getCardShortLinkFromUrl(checkItem.name);
		if (childShortLink === undefined) {
			continue;
		}
		
		parentOfChild = await getPluginData(t, childShortLink, 'parent');
		if (parentOfChild === undefined) {
			continue;
		}
		if (parentOfChild.shortLink !== parentShortLink) {
			if (currentData !== undefined) {
				t.alert({
					message: 'Task "' + checkItem.name + '" on the tasks checklist relates to a different parent.',
				});
			}
			continue;
		}
		
		newData.shortLinks.push(childShortLink);
		newData.checkItemIds[childShortLink] = checkItem.id;
		newData.counts.total += 1;
		if (checkItem.state === 'complete') {
			newData.counts.done += 1;
		}
	}
	
	return newData;
}

/**
 * @param  {object}           t             context
 * @param  {string|undefined} searchTerm
 * @param  {string}           parentOrChild one of 'parent' or 'child'
 * @param  {Function}         callback      to execute when choosing a certain card
 * @return {array}            cards with {
 *         @var {string}   text
 *         @var {Function} callback
 * }
 */
async function searchCards(t, searchTerm, parentOrChild, callback) {
	const pluginData = await t.get('card', 'shared');
	
	// collect current parent & children
	const parentCardShortLink = (pluginData.parent   !== undefined ? pluginData.parent.shortLink    : '');
	const childCardShortLinks = (pluginData.children !== undefined ? pluginData.children.shortLinks : []);
	
	// offer to add by card link
	if (searchTerm !== '' && searchTerm.indexOf('https://trello.com/c/') === 0) {
		return t.cards('id', 'name', 'url', 'shortLink').then(async function(cards) {
			const searchShortLink = getCardShortLinkFromUrl(searchTerm);
			
			// skip already added cards
			if (parentCardShortLink === searchShortLink) {
				return [];
			}
			if (childCardShortLinks.includes(searchShortLink)) {
				return [];
			}
			
			// try to find the title of the linked card
			let matchingCard = cards.find(function(card) {
				return (card.shortLink === searchShortLink);
			});
			
			// skip self
			if (matchingCard !== undefined && matchingCard.id === t.getContext().card) {
				return [];
			}
			
			// get the card from another board
			if (matchingCard === undefined) {
				matchingCard = await getCardByIdOrShortLink(t, searchShortLink);
			}
			
			return [
				{
					text: matchingCard.name,
					callback: function(t) {
						callback(t, matchingCard);
					},
				},
			];
		});
	}
	else {
		return t.cards('id', 'name', 'url', 'shortLink', 'dateLastActivity').then(async function(cards) {
			// skip self and already added cards
			cards = cards.filter(function(card) {
				if (t.getContext().card === card.id) {
					return false;
				}
				if (parentCardShortLink === card.shortLink) {
					return false;
				}
				if (childCardShortLinks.includes(card.shortLink)) {
					return false;
				}
				
				return true;
			});
			
			// filter by search term
			if (searchTerm !== '') {
				cards = cards.filter(function(card) {
					return (card.name.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1);
				});
			}
			
			// favor most recent touched cards
			cards.sort(function(cardA, cardB) {
				return (cardA.dateLastActivity < cardB.dateLastActivity) ? 1 : -1;
			});
			
			// don't process too much
			cards = cards.slice(0, LIST_MAXIMUM);
			
			// create list items
			cards = cards.map(function(card) {
				return {
					text: card.name,
					callback: function(t) {
						callback(t, card);
					},
				};
			});
			
			// add remove buttons
			if (searchTerm === '') {
				if (parentOrChild === 'parent' && pluginData.parent !== undefined) {
					cards.push({
						text:     '× Remove current EPIC',
						callback: function(t) {
							removeParent(t, pluginData.parent);
							t.closePopup();
						},
					});
				}
				
				if (parentOrChild === 'child' && pluginData.children !== undefined) {
					cards.push({
						text:     '× Remove a task ...',
						callback: function(t) {
							showRemoveChildrenForm(t, pluginData.children);
						},
					});
				}
			}
			
			return cards;
		});
	}
}

/**
 * add parent relation to current (child) card
 * 
 * @param {object} t          context
 * @param {object} parentCard {
 *        @var {string}           id
 *        @var {string}           name
 *        @var {string}           url
 *        @var {string}           shortLink
 *        @var {string|undefined} idBoard
 * }
 */
async function addParent(t, parentCard) {
	await t.set('card', 'shared', 'updating', true);
	
	// check existing parent
	await t.get('card', 'shared', 'parent').then(function(parentData) {
		if (parentData !== undefined) {
			return removeParent(t, parentData);
		}
	});
	
	// add parent to child
	const childCardId = t.getContext().card;
	const attachment  = await createAttachment(t, parentCard, childCardId);
	storeParent(t, parentCard, attachment);
	
	// add child to parent
	const checklistId = await getPluginData(t, parentCard.shortLink, 'children').then(async function(childrenData) {
		if (childrenData !== undefined) {
			return childrenData.checklistId;
		}
		
		const checklist = await createChecklist(t, parentCard.id);
		
		return checklist.id;
	});
	
	const childCard = await t.card('url', 'shortLink');
	const checkItem = await createCheckItem(t, childCard, checklistId);
	
	if (parentCard.idBoard !== undefined && parentCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingChildren(t, parentCard.id);
	}
	else {
		storeChild(t, checklistId, childCard, checkItem, parentCard.id);
	}
	
	// give some time before releasing as updating
	// this seems needed as card updates from trello api can still come in
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

/**
 * add child relation to current (parent) card
 * 
 * @param {object} t         context
 * @param {object} childCard {
 *        @var {string}           id
 *        @var {string}           url
 *        @var {string}           shortLink
 *        @var {string|undefined} idBoard
 * }
 */
async function addChild(t, childCard) {
	await t.set('card', 'shared', 'updating', true);
	
	// check existing parent of child
	const parentOfChild = await getPluginData(t, childCard.id, 'parent');
	if (parentOfChild !== undefined) {
		t.alert({
			message: 'That task is already part of another EPIC. Change the EPIC on that card to switch.',
		});
		return;
	}
	
	// add child to parent
	const checklistId = await t.get('card', 'shared', 'children').then(async function(childrenData) {
		if (childrenData !== undefined) {
			return childrenData.checklistId;
		}
		
		const parentCardId = t.getContext().card;
		const checklist    = await createChecklist(t, parentCardId);
		
		return checklist.id;
	});
	
	const checkItem = await createCheckItem(t, childCard, checklistId);
	await storeChild(t, checklistId, childCard, checkItem);
	
	// add parent to child
	const parentCard = await t.card('name', 'url', 'shortLink');
	const attachment = await createAttachment(t, parentCard, childCard.id);
	
	if (childCard.idBoard !== undefined && childCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingParent(t, childCard.id);
	}
	else {
		storeParent(t, parentCard, attachment, childCard.id);
	}
	
	// give some time before releasing as updating
	// this seems needed as card updates from trello api can still come in
	setTimeout(function() {
		t.remove('card', 'shared', 'updating');
	}, 100);
}

/**
 * remove parent relation from current (child) card
 * 
 * @param  {object} t          context
 * @param  {object} parentData {
 *         @var {string} shortLink
 *         @var {string} attachmentId
 * }
 */
async function removeParent(t, parentData) {
	// remove parent from child
	const childCardId = t.getContext().card;
	deleteAttachment(t, childCardId, parentData.attachmentId);
	clearStoredParent(t);
	
	// remove child from parent
	const childCard        = await t.card('shortLink');
	const childrenOfParent = await getPluginData(t, parentData.shortLink, 'children');
	const checklistId      = childrenOfParent.checklistId;
	const checkItemId      = childrenOfParent.checkItemIds[childCard.shortLink];
	await deleteCheckItem(t, checklistId, checkItemId);
	
	const parentCard = await getCardByIdOrShortLink(t, parentData.shortLink);
	if (parentCard.idBoard !== undefined && parentCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingChildren(t, parentCard.id);
	}
	else {
		clearStoredChild(t, childCard.shortLink, parentCard.id);
	}
}

/**
 * remove all(!) children relations from current (parent) card
 * 
 * @param  {object} t            context
 * @param  {object} childrenData {
 *         @var {string}   checklistId
 *         @var {string[]} shortLinks
 * }
 */
async function removeChildren(t, childrenData) {
	// remove children from parent
	const parentCardId = t.getContext().card;
	deleteChecklist(t, parentCardId, childrenData.checklistId);
	clearStoredChildren(t);
	
	// remove parent from each child
	let attachmentId = undefined;
	for (childShortLink of childrenData.shortLinks) {
		const parentOfChild = await getPluginData(t, childShortLink, 'parent');
		deleteAttachment(t, childShortLink, parentOfChild.attachmentId);
		
		const childCard = await getCardByIdOrShortLink(t, childShortLink);
		if (childCard.idBoard !== undefined && childCard.idBoard !== t.getContext().board) {
			// use organization-level plugindata to store parent data for cross-board relations
			queueSyncingParent(t, childCard.id);
		}
		else {
			clearStoredParent(t, childShortLink);
		}
	}
}

/**
 * remove one child relation from current (parent) card
 * 
 * @param  {object} t            context
 * @param  {object} childrenData {
 *         @var {string} checklistId
 *         @var {object} checkItemIds map of shortLinks to checkItemIds
 * }
 * @param  {string} shortLink    of the child card to remove
 */
async function removeChild(t, childrenData, shortLink) {
	// remove child from parent
	const checklistId = childrenData.checklistId;
	const checkItemId = childrenData.checkItemIds[shortLink];
	await deleteCheckItem(t, checklistId, checkItemId);
	await clearStoredChild(t, shortLink);
	
	// remove parent from child
	const parentOfChild = await getPluginData(t, shortLink, 'parent');
	await deleteAttachment(t, shortLink, parentOfChild.attachmentId);
	const childCard = await getCardByIdOrShortLink(t, shortLink);
	if (childCard.idBoard !== undefined && childCard.idBoard !== t.getContext().board) {
		// use organization-level plugindata to store parent data for cross-board relations
		queueSyncingParent(t, childCard.id);
	}
	else {
		clearStoredParent(t, shortLink);
	}
}

/**
 * process queue of actions delayed because the card was out of context
 * 
 * @param  {object}  t          context
 * @param  {string}  badgeType  front ('card-badges') or back ('card-detail-badges') of the card
 * @param  {Promise} pluginData
 */
function processQueue(t, badgeType, pluginData) {
	if (badgeType === 'card-badges') {
		pluginData.then(async function(pluginData) {
			// cleanup data for copied cards
			if (pluginData.copyDetection !== undefined && pluginData.copyDetection !== t.getContext().card) {
				// we can only cleanup the plugindata, let the user delete the attachment/checklists
				// the attachment/checklist ids got regenerated for the copied card, thus we can't (easily) delete them
				// also, users might want to keep them
				clearStoredData(t);
				t.alert({
					message:  'Relationships on the copied card are disconnected. You can delete the attachment/checklist, and optionally re-create the prefered relations.',
					duration: 10,
				});
			}
		});
	}
	
	if (badgeType === 'card-detail-badges') {
		// process cross-board queue to add parents to children
		t.get('organization', 'shared', 'sync-parent-' + t.getContext().card, false).then(function(shouldSyncParent) {
			if (shouldSyncParent === false) {
				return;
			}
			
			t.remove('organization', 'shared', 'sync-parent-' + t.getContext().card);
			getSyncParentData(t).then(function(syncData) {
				if (syncData.parentCard === undefined) {
					clearStoredParent(t);
				}
				else {
					storeParent(t, syncData.parentCard, syncData.attachment);
				}
			})
			.catch(function(error) {
				console.warn('Error processing queue to sync parent', error);
				t.alert({
					message: 'Something went wrong adding the EPIC, try creating the relationship again.',
				});
			});
		});
		
		pluginData.then(async function(pluginData) {
			const childrenData = pluginData.children;
			
			// process cross-board queue to add children to parents
			t.get('organization', 'shared', 'sync-children-' + t.getContext().card, false).then(async function(shouldSyncChildren) {
				if (shouldSyncChildren === false) {
					return;
				}
				
				t.remove('organization', 'shared', 'sync-children-' + t.getContext().card);
				
				const parentCard = await t.card('shortLink');
				getSyncChildrenData(t, parentCard.shortLink, childrenData).then(function(newData) {
					storeChildren(t, newData);
				})
				.catch(function(error) {
					console.warn('Error processing queue to sync children', error);
					t.alert({
						message: 'Something went wrong adding the task, try creating the relationship again.',
					});
				});
			});
			
			// process marking child checkitems as complete
			if (childrenData !== undefined && pluginData.updating === undefined) {
				getChildrenCountData(t, childrenData).then(function(newCounts) {
					if (JSON.stringify(newCounts) !== JSON.stringify(childrenData.counts)) {
						childrenData.counts = newCounts;
						storeChildren(t, childrenData);
					}
				});
			}
		});
	}
}

/**
 * store parent metadata
 * 
 * @param  {object} t             without context
 * @param  {object} parentCard {
 *         @var {string} shortLink
 *         @var {string} name
 * }
 * @param  {object} attachment {
 *         @var {string} id
 * }
 * @param  {string} contextCardId optional, defaults to context of the current card
 */
function storeParent(t, parentCard, attachment, contextCardId='card') {
	const cardId = (contextCardId !== 'card') ? contextCardId : t.getContext().card;
	
	t.set(contextCardId, 'shared', {
		copyDetection: cardId,
		parent:        {
			attachmentId: attachment.id,
			shortLink:    parentCard.shortLink,
			name:         parentCard.name,
		},
	});
}

/**
 * store child metadata of a new child
 * 
 * @param  {object} t             without context
 * @param  {string} checklistId
 * @param  {objdct} childCard {
 *         @var {string} shortLink
 * }
 * @param  {objdct} checkItem {
 *         @var {string} id
 * }
 * @param  {string} contextCardId optional, defaults to context of the current card
 */
function storeChild(t, checklistId, childCard, checkItem, contextCardId='card') {
	const cardId = (contextCardId !== 'card') ? contextCardId : t.getContext().card;
	
	const defaultChildrenData = {
		checklistId:  checklistId,
		shortLinks:   [],
		checkItemIds: {},
		counts:       {total: 0, done:  0},
	};
	
	t.get(contextCardId, 'shared', 'children', defaultChildrenData).then(async function(childrenData) {
		childrenData.shortLinks.push(childCard.shortLink);
		childrenData.checkItemIds[childCard.shortLink] = checkItem.id;
		childrenData.counts.total += 1;
		
		t.set(contextCardId, 'shared', {
			copyDetection: cardId,
			children:      childrenData,
		});
	});
}

/**
 * store children metadata of all children
 * 
 * @param  {object} t             without context
 * @param  {object} childrenData {
 *         @var {string}   checklistId
 *         @var {string[]} shortLinks
 *         @var {object}   checkItemIds map of shortLinks to checkItemIds
 *         @var {object}   counts {
 *              @var {int} total
 *              @var {int} done
 *         }
 * }
 * @param  {string} contextCardId optional, defaults to context of the current card
 */
function storeChildren(t, childrenData, contextCardId='card') {
	const cardId = (contextCardId !== 'card') ? contextCardId : t.getContext().card;
	
	t.set(contextCardId, 'shared', {
		copyDetection: cardId,
		children:      childrenData,
	});
}

/**
 * store children metadata for a cross-board relationship
 * 
 * @param  {object} t            without context
 * @param  {string} parentCardId
 */
function queueSyncingChildren(t, parentCardId) {
	t.set('organization', 'shared', 'sync-children-' + parentCardId, true);
}

/**
 * store parent metadata for a cross-board relationship
 * 
 * @param  {object} t           without context
 * @param  {string} childCardId
 */
function queueSyncingParent(t, childCardId) {
	t.set('organization', 'shared', 'sync-parent-' + childCardId, true);
}

/**
 * clear stored parent metadata
 * 
 * @param  {object} t             without context
 * @param  {string} contextCardId optional, defaults to context of the current card
 */
function clearStoredParent(t, contextCardId='card') {
	t.remove(contextCardId, 'shared', 'parent');
}

/**
 * clear stored child metadata
 * 
 * @param  {object} t              without context
 * @param  {string} childShortLink the one to remove
 * @param  {string} contextCardId  the parent, optional, defaults to context of the current card
 * @return {Promise}
 */
function clearStoredChild(t, childShortLink, contextCardId='card') {
	return t.get(contextCardId, 'shared', 'children').then(async function(childrenData) {
		const index = childrenData.shortLinks.indexOf(childShortLink);
		
		childrenData.shortLinks.splice(index, 1);
		delete childrenData.checkItemIds[childShortLink];
		childrenData.counts = await getChildrenCountData(t, childrenData);
		
		storeChildren(t, childrenData, contextCardId);
	});
}

/**
 * clear stored children metadata
 * 
 * @param  {object} t context
 */
function clearStoredChildren(t) {
	t.remove('card', 'shared', 'children');
}

/**
 * clear all stored metadata
 * 
 * @param  {object} t context
 */
function clearStoredData(t) {
	t.remove('card', 'shared', [
		'children',
		'copyDetection',
		'parent',
		'updating',
	]);
}

/**
 * add attachment to store parent on a card
 * attach via Rest API instead of t.attach() to get attachment id
 * 
 * @param {object} t                      without context
 * @param {object} parentCard {
 *        @var {string} name
 *        @var {string} url
 * }
 * @param {string} childCardIdOrShortLink
 * @return {Promise} => {object} attachment {
 *         @var {string} id
 * }
 */
function createAttachment(t, parentCard, childCardIdOrShortLink) {
	const postData = {
		name: 'EPIC: ' + parentCard.name,
		url:  parentCard.url,
	};
	
	try {
		return window.Trello.post('cards/' + childCardIdOrShortLink + '/attachments', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * add checklist to host children on a card
 * 
 * @param {object} t                       without context
 * @param {object} parentCardIdOrShortLink
 * @return {Promise} => {object} checklist {
 *         @var {string} id
 * }
 */
function createChecklist(t, parentCardIdOrShortLink) {
	const postData = {
		name: 'Tasks',
		pos:  'top',
	};
	
	try {
		return window.Trello.post('cards/' + parentCardIdOrShortLink + '/checklists', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param {object} t           without context
 * @param {object} childCard {
 *        @var {string} url
 * }
 * @param {string} checklistId
 * @return {Promise} => {object} checkItem {
 *         @var {string} id
 * }
 */
function createCheckItem(t, childCard, checklistId) {
	const postData = {
		name: childCard.url,
		pos:  'bottom',
	};
	
	try {
		return window.Trello.post('checklists/' + checklistId + '/checkItems', postData, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t                 without context
 * @param  {string} cardIdOrShortLink
 * @param  {string} attachmentId
 * @return {Promise}
 */
function deleteAttachment(t, cardIdOrShortLink, attachmentId) {
	try {
		return window.Trello.delete('cards/' + cardIdOrShortLink + '/attachments/' + attachmentId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t                 without context
 * @param  {object} cardIdOrShortLink
 * @param  {string} checklistId
 * @return {Promise}
 */
function deleteChecklist(t, cardIdOrShortLink, checklistId) {
	try {
		return window.Trello.delete('cards/' + cardIdOrShortLink + '/checklists/' + checklistId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * @param  {object} t           without context
 * @param  {string} checklistId
 * @param  {string} checkItemId
 * @return {Promise}
 */
function deleteCheckItem(t, checklistId, checkItemId) {
	try {
		return window.Trello.delete('checklists/' + checklistId + '/checkItems/' + checkItemId, {}, null,
		function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

/**
 * show badge on a parent card to give information about the children
 * 
 * @param  {object}  t          context
 * @param  {string}  badgeType  front ('card-badges') or back ('card-detail-badges') of the card
 * @param  {Promise} pluginData
 * @return {object} {
 *         @var {string} icon  optional, only for front badges
 *         @var {string} title optional, only for back badges
 *         @var {string} text
 *         @var {string} color
 * }
 */
function showBadgeOnParent(t, badgeType, pluginData) {
	return pluginData.then(async function(pluginData) {
		if (pluginData.children === undefined) {
		 	return {};
		}
		
		const childrenData = pluginData.children;
		const color        = (childrenData.counts.done > 0 && childrenData.counts.done === childrenData.counts.total) ? 'green' : 'light-gray';
		
		switch (badgeType) {
			case 'card-badges':
				return {
					icon:  ICON_DOWN,
					text:  childrenData.counts.done + '/' + childrenData.counts.total + ' tasks',
					color: color,
				};
			
			case 'card-detail-badges':
				return {
					title: 'Tasks',
					text:  childrenData.counts.done + '/' + childrenData.counts.total,
					color: color,
				};
		}
	});
}

/**
 * show badge on a child card to give information about the parent
 * 
 * @param  {object}  t          context
 * @param  {string}  badgeType  front ('card-badges') or back ('card-detail-badges') of the card
 * @param  {Promise} pluginData
 * @return {object} {
 *         @var {string}   icon     optional, only for front badges
 *         @var {string}   title    optional, only for back badges
 *         @var {string}   text
 *         @var {string}   color    optional, only for front badges
 *         @var {Function} callback optional, only for back badges
 * }
 */
function showBadgeOnChild(t, badgeType, pluginData) {
	return pluginData.then(async function(pluginData) {
		if (pluginData.parent === undefined) {
			return {};
		}
		
		const parentData = pluginData.parent;
		
		switch (badgeType) {
			case 'card-badges':
				const shortName = (parentData.name.length > 20) ? parentData.name.substring(0, 20) + ' ...' : parentData.name;
				
				return {
					icon:  ICON_UP,
					text:  'part of ' + shortName,
					color: 'light-gray',
				};
			
			case 'card-detail-badges':
				return {
					title: 'Part of EPIC',
					text:  parentData.name,
					callback: function(t) {
						t.showCard(parentData.shortLink);
					},
				};
		}
	});
}

/**
 * @param  {object} t context
 * @return {Promise}
 */
function showParentForm(t) {
	return t.popup({
		title: 'Add an EPIC',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options.search, 'parent', function(t, card) {
				addParent(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @return {Promise}
 */
function showChildrenForm(t) {
	return t.popup({
		title: 'Add a task',
		search: {
			placeholder: 'Search or paste a link',
			empty: 'Not found in card titles. — You can also paste a link to a card.',
			searching: '...',
			debounce: 300,
		},
		items: function(t, options) {
			return searchCards(t, options.search, 'child', function(t, card) {
				addChild(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t            context
 * @param  {object} childrenData {
 *         @var {string}   checklistId
 *         @var {string[]} shortLinks
 *         @var {object}   checkItemIds map of shortLinks to checkItemIds
 * }
 * @return {Promise}
 */
function showRemoveChildrenForm(t, childrenData) {
	return t.popup({
		title: 'Remove a task',
		items: async function(t, options) {
			const popupItems     = [];
			const shortLinks     = childrenData.shortLinks.slice(); // copy
			const cardsInContext = await t.cards('name', 'shortLink');
			
			for (let cardInsideContext of cardsInContext) {
				let index = shortLinks.indexOf(cardInsideContext.shortLink);
				if (index === -1) {
					continue;
				}
				
				popupItems.push({
					text: cardInsideContext.name,
					callback: function(t) {
						removeChild(t, childrenData, cardInsideContext.shortLink);
						t.closePopup();
					},
				});
				shortLinks.splice(index, 1);
			}
			
			for (let shortLink of shortLinks) {
				let cardOutsideContext = await getCardByIdOrShortLink(t, shortLink);
				popupItems.push({
					text: cardOutsideContext.name,
					callback: function(t) {
						removeChild(t, childrenData, cardOutsideContext.shortLink);
						t.closePopup();
					},
				});
			}
			
			if (popupItems.length > 2) {
				popupItems.push({
					text: '× Remove all tasks ...',
					callback: function(t) {
						t.popup({
							type:         'confirm',
							title:        'Remove all tasks',
							message:      'This will remove the relationship between all tasks and this epic. It will also remove the whole tasks checklist.',
							confirmStyle: 'danger',
							confirmText:  'Delete it all, I\'m sure!',
							cancelText:   'Never mind',
							onConfirm:    function(t) {
								removeChildren(t, childrenData);
								t.closePopup();
							},
						});
					},
				});
			}
			
			return popupItems;
		},
	});
}

/**
 * @param  {object} t context
 * @return {Promise}
 */
function showDebug(t) {
	return t.popup({
		title: 'Debug EPIC relation',
		items: async function(t) {
			let items = [];
			
			const dateLastActivity = await t.card('dateLastActivity').then(function(card) {
				return card.dateLastActivity;
			});
			items.push({text: 'last activity: ' + dateLastActivity});
			
			const pluginData = await t.get('card', 'shared');
			
			if (pluginData.copyDetection !== undefined) {
				items.push({text: 'copy detection: ' + pluginData.copyDetection});
			}
			else {
				items.push({text: 'copy detection: -'});
			}
			
			if (pluginData.updating !== undefined) {
				items.push({text: 'updating: yes'});
			}
			else {
				items.push({text: 'updating: no'});
			}
			
			if (pluginData.parent !== undefined) {
				items.push({text: 'parent:'});
				items.push({text: '- attachmentId: ' + pluginData.parent.attachmentId});
				items.push({text: '- shortLink: ' + pluginData.parent.shortLink});
				items.push({text: '- name: ' + pluginData.parent.name});
			}
			else {
				items.push({text: 'parent: -'});
			}
			
			if (pluginData.children !== undefined) {
				items.push({text: 'children:'});
				items.push({text: '- checklistId: ' + pluginData.children.checklistId});
				items.push({text: '- shortLinks: ' + JSON.stringify(pluginData.children.shortLinks)});
				items.push({text: '- checkItemIds: ' + JSON.stringify(pluginData.children.checkItemIds)});
				items.push({text: '- counts: ' + JSON.stringify(pluginData.children.counts)});
			}
			else {
				items.push({text: 'children: -'});
			}
			
			return items;
		},
	});
}

/**
 * @param  {object} t without context
 * @return {bool}
 */
function initializeAuthorization(t) {
	return t.get('member', 'private', 'token').then(function(token) {
		if (token === undefined) {
			return false;
		}
		
		window.Trello.setToken(token);
		return true;
	},
	function() {
		return false;
	});
}

/**
 * @param  {object} t context
 * @return {Promise}
 */
function startAuthorization(t) {
	return t.popup({
		title:  'My Auth Popup',
		height: 170,
		url:    './authorize.html',
		args:   {
			apiKey: '9b174ff1ccf5ca94f1c181bc3d802d4b',
		},
	});
}

TrelloPowerUp.initialize({
	'card-buttons': function(t) {
		return initializeAuthorization(t).then(function(isAuthorized) {
			if (isAuthorized === false) {
				return [];
			}
			
			const cardButtons = [
				{
					text:      'EPIC',
					icon:      ICON_UP,
					condition: 'edit',
					callback:  showParentForm,
				},
				{
					text:      'Tasks',
					icon:      ICON_DOWN,
					condition: 'edit',
					callback:  showChildrenForm,
				},
			];
			
			if (SHOW_DEBUG) {
				cardButtons.push({
					text:      'Debug',
					icon:      FAVICON,
					condition: 'edit',
					callback:  showDebug,
				});
			}
			
			return cardButtons;
		});
	},
	'card-badges': function(t, options) {
		const pluginData = t.get('card', 'shared');
		
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command, pluginData);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command, pluginData);
				},
			},
			{
				dynamic: function() {
					return processQueue(t, options.context.command, pluginData);
				},
			},
		];
	},
	'card-detail-badges': function(t, options) {
		const pluginData = t.get('card', 'shared');
		
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command, pluginData);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command, pluginData);
				},
			},
			{
				dynamic: function() {
					return processQueue(t, options.context.command, pluginData);
				},
			},
		];
	},
	'authorization-status': function(t) {
		return t.get('member', 'private', 'token').then(function(token) {
			const isAuthorized = (token !== undefined);
			
			return {
				authorized: isAuthorized,
			};
		});
	},
	'show-authorization': function(t) {
		return startAuthorization(t);
	},
}, {
	appKey:  '9b174ff1ccf5ca94f1c181bc3d802d4b',
	appName: 'EPIC relations',
});
