/* global TrelloPowerUp */

var Promise = TrelloPowerUp.Promise;

const CDN_BASE_URL = document.getElementById('js-cdn-base-url').href;
const FAVICON      = CDN_BASE_URL + 'favicon.png';
const ICON_UP      = CDN_BASE_URL + 'icon-up.png';
const ICON_DOWN    = CDN_BASE_URL + 'icon-down.png';
const LIST_MAXIMUM = 10;

/**
 * @param  {string} cardUrl
 * @return {string} shortLink
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
 * @param  {object} t without context
 * @param  {string} cardIdOrShortLink
 * @return {object} card {
 *         @var {string} id
 *         @var {string} name
 *         @var {string} url
 * }
 */
async function getCardByIdOrShortLink(t, cardIdOrShortLink) {
	try {
		const response = await window.Trello.get('cards/' + cardIdOrShortLink + '?fields=id,name,url,shortLink', {}, null, function(error) {
			t.alert({
				message: JSON.stringify(error, null, '\t'),
			});
		});
		
		return {
			id:   response.id,
			name: response.name,
			url:  response.url,
		};
	}
	catch (error) {
		t.alert({
			message: JSON.stringify(error, null, '\t'),
		});
	}
}

async function getPluginData(t, cardIdOrShortLink, parentOrChildren) {
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

async function hasParentToConnect(t, attachments) {
	// @todo check last modified against a cache
	
	if (attachments === undefined) {
		attachments = await t.card('attachments').then(function(card) {
			return card.attachments;
		});
	}
	
	if (attachments.length === 0) {
		return false;
	}
	
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		return false;
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
		
		return {
			parentCard: parentCard,
			attachment: attachment,
		};
	}
	
	return false;
}

async function hasChildrenToConnect(t) {
	// @todo check last modified against a cache
	
	const isAuthorized = await initializeAuthorization(t);
	if (isAuthorized === false) {
		return false;
	}
	
	const parentCardId = t.getContext().card;
	const checklists = await getChecklists(t, parentCardId);
	if (checklists.length === 0) {
		return false;
	}
	
	const parentShortLink = await t.card('shortLink').then(function(card) {
		return card.shortLink;
	})
	
	let childShortLink;
	let parentOfChild;
	let childrenShortLinks;
	
	// @todo check if we already know the checklist
	// @todo check which children we already know
	
	for (let checklist of checklists) {
		if (checklist.checkItems.length === 0) {
			continue;
		}
		
		childrenShortLinks = [];
		for (let checkItem of checklist.checkItems) {
			childShortLink = getCardShortLinkFromUrl(checkItem.name);
			if (childShortLink === undefined) {
				continue;
			}
			
			parentOfChild = await getPluginData(t, childShortLink, 'parent');
			if (parentOfChild === undefined) {
				continue;
			}
			if (parentOfChild.shortLink !== parentShortLink) {
				break;
			}
			
			childrenShortLinks.push(childShortLink);
		}
		
		if (childrenShortLinks.length === 0) {
			continue;
		}
		
		return {
			shortLinks: childrenShortLinks,
			checklist:  checklist,
		}
	}
	
	return false;
}

/**
 * @param  {object}   t             context
 * @param  {object}   options       from context, containing optional search keyword
 * @param  {string}   parentOrChild one of 'parent' or 'child'
 * @param  {Function} callback      to execute when choosing a certain card
 * @return {array}                  cards with {
 *         @var {string}   text
 *         @var {Function} callback
 * }
 */
async function searchCards(t, options, parentOrChild, callback) {
	const searchTerm = options.search;
	
	// collect current parent
	let parentCardShortLink = undefined;
	// @todo re-enable filtering out existing relations
	//#await t.get('card', 'shared', 'parentAttachmentId').then(async function(parentAttachmentId) {
	//#	if (parentAttachmentId !== undefined) {
	//#		parentCardShortLink = await getParentShortLinkByAttachmentId(t, parentAttachmentId);
	//#	}
	//#});
	
	// get current children
	const childCardShortLinks = []; //# await t.get('card', 'shared', 'childrenShortLinks');
	
	// offer to add by card link
	if (searchTerm !== '' && searchTerm.indexOf('https://trello.com/c/') === 0) {
		return t.cards('id', 'name', 'url', 'shortLink').then(async function(cards) {
			const searchShortLink = getCardShortLinkFromUrl(searchTerm);
			
			// skip already added cards
			if (parentCardShortLink !== undefined && parentCardShortLink === searchShortLink) {
				return [];
			}
			if (childCardShortLinks !== undefined && childCardShortLinks.includes(searchShortLink)) {
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
					callback: function(t, options) {
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
				if (parentCardShortLink !== undefined && parentCardShortLink === card.shortLink) {
					return false;
				}
				if (childCardShortLinks !== undefined && childCardShortLinks.includes(card.shortLink)) {
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
					callback: function(t, options) {
						callback(t, card);
					},
				};
			});
			
			// add remove buttons
			// @todo re-enable buttons to remove parent/children
			//#if (searchTerm === '') {
			//#	if (parentOrChild === 'parent') {
			//#		await t.get('card', 'shared', 'parentAttachmentId').then(function(parentAttachmentId) {
			//#			if (parentAttachmentId !== undefined) {
			//#				cards.push({
			//#					text:     '× Remove current EPIC',
			//#					callback: function(t, options) {
			//#						removeParentFromContext(t, parentAttachmentId);
			//#						t.closePopup();
			//#					},
			//#				});
			//#			}
			//#		});
			//#	}
			//#	
			//#	if (parentOrChild === 'child') {
			//#		await t.get('card', 'shared', 'childrenChecklistId').then(function(childrenChecklistId) {
			//#			if (childrenChecklistId !== undefined) {
			//#				cards.push({
			//#					text:     '× Remove all tasks (remove the EPIC from the task card to remove a single task)',
			//#					callback: function(t, options) {
			//#						removeChildrenFromContext(t);
			//#						t.closePopup();
			//#					},
			//#				});
			//#			}
			//#		});
			//#	}
			//#}
			
			return cards;
		});
	}
}

async function addParent(t, parentCard) {
	const childCardId = t.getContext().card;
	const attachment  = await addAttachment(t, parentCard, childCardId);
	storeParent(t, parentCard, attachment);
	
	const childCard = await t.card('url');
	// @todo don't create double checklists
	const checklist = await addChecklist(t, parentCard.id);
	addCheckItem(t, childCard, checklist.id);
}

async function addChild(t, childCard) {
	const parentCardId = t.getContext().card;
	// @todo don't create double checklists
	const checklist    = await addChecklist(t, parentCardId);
	addCheckItem(t, childCard, checklist.id);
	storeChild(t, childCard, checklist);
	
	const parentCard = await t.card('url');
	addAttachment(t, parentCard, childCard.id);
}

function storeParent(t, parentCard, attachment) {
	t.set('card', 'shared', 'parent', {
		attachmentId: attachment.id,
		shortLink:    parentCard.shortLink,
		name:         parentCard.name,
	});
}

function storeChild(t, childCard, checklist) {
	t.get('card', 'shared', 'children').then(function(children) {
		if (children === undefined) {
			children = {
				checklistId: checklist.id,
				shortLinks:  [],
				counts:      {total: 0, done:  0},
			};
		}
		
		children.shortLinks.push(childCard.shortLink);
		children.counts.total += 1;
		
		t.set('card', 'shared', 'children', children);
	});
}

/**
 * add parent
 * attach via Rest API instead of t.attach() to get attachment id
 * 
 * @param {object} t without context
 * @param {object} parentCard {
 *        @var {string} url
 * }
 * @param {string} childCardIdOrShortLink
 * @return {Promise}
 */
function addAttachment(t, parentCard, childCardIdOrShortLink) {
	const postData = {
		name: 'EPIC',
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
 * @param {object} t without context
 * @param {object} parentCardIdOrShortLink
 * @return {Promise}
 */
function addChecklist(t, parentCardIdOrShortLink) {
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
 * @param {object} t without context
 * @param {object} childCard {
 *        @var {string} url
 * }
 * @param {string} checklistId
 * @return {Promise}
 */
function addCheckItem(t, childCard, checklistId) {
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

function showBadgeOnParent(t, badgeType) {
	return t.get('card', 'shared', 'children').then(async function(children) {
		if (children === undefined) {
			hasChildrenToConnect(t).then(function(childrenData) {
				if (childrenData !== false) {
					for (let childShortLink of childrenData.shortLinks) {
						storeChild(t, {shortLink: childShortLink}, childrenData.checklist);
					}
				}
			});
			
			return {};
		}
		
		const color = (children.counts.done > 0 && children.counts.done === children.counts.total) ? 'green' : 'light-gray';
		
		switch (badgeType) {
			case 'card-badges':
				return {
					icon:  ICON_DOWN,
					text:  children.counts.done + '/' + children.counts.total + ' tasks',
					color: color,
				};
			
			case 'card-detail-badges':
				return {
					title: 'Tasks',
					text:  children.counts.done + '/' + children.counts.total,
					color: color,
				};
		}
	});
}

function showBadgeOnChild(t, badgeType, attachments) {
	return t.get('card', 'shared', 'parent').then(async function(parent) {
		if (parent === undefined) {
			hasParentToConnect(t, attachments).then(function(parentData) {
				if (parentData !== false) {
					storeParent(t, parentData.parentCard, parentData.attachment);
				}
			});
			
			return {};
		}
		
		switch (badgeType) {
			case 'card-badges':
				return {
					icon:  ICON_UP,
					text:  'part of ' + parent.name,
					color: 'light-gray',
				};
			
			case 'card-detail-badges':
				return {
					title: 'Part of EPIC',
					text:  parent.name,
					callback: function(t, options) {
						t.showCard(parent.shortLink);
					},
				};
		}
	});
}

/**
 * @param  {object} t context
 * @return {object}
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
			return searchCards(t, options, 'parent', function(t, card) {
				addParent(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @return {object}
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
			return searchCards(t, options, 'child', function(t, card) {
				addChild(t, card);
				t.closePopup();
			});
		},
	});
}

/**
 * @param  {object} t context
 * @return {object}
 */
function showDebug(t) {
	return t.popup({
		title: 'Add a task',
		items: async function(t, options) {
			let items = [];
			
			const parent   = await t.get('card', 'shared', 'parent');
			if (parent !== undefined) {
				items.push({text: 'parent.attachmentId: ' + parent.attachmentId});
				items.push({text: 'parent.shortLink: ' + parent.shortLink});
				items.push({text: 'parent.name: ' + parent.name});
				items.push({text: 'parent.badges: ' + JSON.stringify(parent.badges)});
			}
			else {
				items.push({text: 'parent: -'});
			}
			
			const children = await t.get('card', 'shared', 'children');
			if (children !== undefined) {
				items.push({text: 'children.checklistId: ' + children.checklistId});
				items.push({text: 'children.shortLinks: ' + children.shortLinks.join(',')});
				items.push({text: 'children.counts: ' + JSON.stringify(children.counts)});
				items.push({text: 'children.badges: ' + JSON.stringify(children.badges)});
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
 * @return {object}
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
	'card-buttons': function(t, options) {
		return initializeAuthorization(t).then(function(isAuthorized) {
			if (isAuthorized === false) {
				return [];
			}
			
			return [
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
				{
					text:      'Debug',
					icon:      FAVICON,
					condition: 'edit',
					callback:  showDebug,
				}
			];
		});
	},
	'card-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command, options.attachments);
				},
			},
		];
	},
	'card-detail-badges': function(t, options) {
		return [
			{
				dynamic: function() {
					return showBadgeOnParent(t, options.context.command);
				},
			},
			{
				dynamic: function() {
					return showBadgeOnChild(t, options.context.command);
				},
			},
		];
	},
	'authorization-status': function(t, options) {
		return t.get('member', 'private', 'token').then(function(token) {
			const isAuthorized = (token !== undefined);
			
			return {
				authorized: isAuthorized,
			};
		});
	},
	'show-authorization': function(t, options) {
		return startAuthorization(t);
	},
}, {
	appKey:  '9b174ff1ccf5ca94f1c181bc3d802d4b',
	appName: 'EPIC relations',
});
