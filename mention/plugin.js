/*global tinymce, jQuery */

(function (tinymce, $) {
    'use strict';

    // Tracker object
    var Tracker = function(ed, autoCompleteData){
      this.acData = autoCompleteData;
      this.rules = this.acData.rules;
      this.editor = ed;
    }

    Tracker.prototype.match = function(autoCompleteData){
      autoComplete = new AutoComplete(ed, $.extend({}, autoCompleteData));
    }

    // Called every keypress to check against all existing rules.
    // On match, build and execute AUTOCOMPLETE
    Tracker.prototype.check = function(){
        var rng = this.editor.selection.getRng();
        if (!rng.collapsed){
          return;
        }
        var $node = $(rng.startContainer);
        if ($node[0].nodeType !== Node.TEXT_NODE){
          return;
        }
        var poststr = $node.text().substring(rng.startOffset);
        var endpos = poststr.search(/[^a-zA-Z1-9]|$/);
        //default to length of string (all remaining chars are valid)
        if(endpos<0){
          endpos = poststr.length;
        }
        var searchstr = $node.text().substring(0, rng.startOffset + endpos);
        console.log(searchstr);
        var matchingRules = findMatchingRules(this.rules, searchstr);
        if(matchingRules.length>0){
          if (this.autoComplete === undefined || (this.autoComplete.hasFocus !== undefined && !this.autoComplete.hasFocus)){
            var startOffset = findExactMatch(searchstr, matchingRules[0].rule);//Match the first rule, for the time being
            var endOffset = rng.startOffset + endpos;
            this.autoComplete = new AutoComplete(this.editor, $.extend( {}, this.acData,
                                                          {
                                                            parentNode: $node[0],
                                                            startOffset: startOffset,
                                                            endOffset: endOffset,
                                                            isImplicit: true,
                                                            rules: matchingRules
                                                          }));
          }
        }

        function findExactMatch(str, re) {
          for (var begin=str.length; begin>-1; --begin) {
            if (re.test(str.substring(begin, str.length))) {
              return begin;
            }
          }
          return begin;
        }
    }

    function findMatchingRules(rules, query){
        return rules.filter(function(item){
          return item.rule.test(query);
        });
    }

    // Autocomplete Object
    var AutoComplete = function (ed, options) {
        this.editor = ed;

        this.options = $.extend({}, {
            source: [],
            delay: 500,
            queryBy: 'name',
            items: 10
        }, options);

        // Implicit tags contain the following options:
        // isImplicit: true;
        // rules: []
        // parentNode: node
        // startOffset
        // endOffset
        this.isImplicit   = this.options.isImplicit || false;
        this.rules        = this.options.rules || [];
        this.parentNode   = this.options.parentNode;
        this.startOffset  = this.options.startOffset;
        this.endOffset    = this.options.endOffset;

        this.matcher = this.options.matcher || this.matcher;
        this.renderDropdown = this.options.renderDropdown || this.renderDropdown;
        this.render = this.options.render || this.render;
        this.highlighter = this.options.highlighter || this.highlighter;

        if (this.options.isImplicit){
            //build the query manually
            this.renderImplicitInput();
        }else{
          this.query = '';
          this.renderInput();
        }
        this.hasFocus = true;
        this.bindEvents();
    };

    AutoComplete.prototype = {

        constructor: AutoComplete,

        renderInput: function () {
            var rawHtml =  '<span id="autocomplete">' +
                                '<span id="autocomplete-delimiter">' + this.options.delimiter + '</span>' +
                                '<span id="autocomplete-searchtext"><span class="dummy">\uFEFF</span></span>' +
                            '</span>';

            this.editor.execCommand('mceInsertContent', false, rawHtml);
            this.editor.focus();
            this.editor.selection.select(this.editor.selection.dom.select('span#autocomplete-searchtext span')[0]);
            this.editor.selection.collapse(0);
        },

        renderImplicitInput: function(){
          var $node = $(this.parentNode);
          var sOffset = this.startOffset;
          var eOffset = this.endOffset;
          var queryString = $node.text().substring(sOffset,eOffset);
          var prestr = $node.text().substring(0,sOffset);
          var poststr = $node.text().substring(eOffset);
          var rawHtml = '<span id="autocomplete">' +
                              '<span id="autocomplete-searchtext"><span class="dummy">\uFEFF' + queryString + '</span></span>' +
                          '</span>';
          var range = document.createRange();
          range.setStart(this.parentNode, this.startOffset);
          range.setEnd(this.parentNode, this.endOffset);
          this.editor.selection.setRng(range);
          this.editor.selection.setContent(rawHtml);
          this.editor.focus();
          this.editor.selection.select(this.editor.selection.dom.select('span#autocomplete-searchtext span')[0]);
          this.editor.selection.collapse(0);
          this.query = queryString;

          // Call lookup so that dropdown is shown as soon as there's a match
          if (this.query.length > 0) {
            this.lookup();
          }
        },

        bindEvents: function () {
            this.editor.on('keyup', this.editorKeyUpProxy = $.proxy(this.rteKeyUp, this));
            this.editor.on('keydown', this.editorKeyDownProxy = $.proxy(this.rteKeyDown, this), true);
            this.editor.on('click', this.editorClickProxy = $.proxy(this.rteClicked, this));

            $('body').on('click', this.bodyClickProxy = $.proxy(this.rteLostFocus, this));

            $(this.editor.getWin()).on('scroll', this.rteScroll = $.proxy(function () { this.cleanUp(true); }, this));
        },

        unbindEvents: function () {
            this.editor.off('keyup', this.editorKeyUpProxy);
            this.editor.off('keydown', this.editorKeyDownProxy);
            this.editor.off('click', this.editorClickProxy);

            $('body').off('click', this.bodyClickProxy);

            $(this.editor.getWin()).off('scroll', this.rteScroll);
        },

        rteKeyUp: function (e) {
            // We want to keep as clean as possible:
            if(this.isImplicit && findMatchingRules(this.rules, this.query).length === 0 ) {
                var self = this;
                setTimeout(function(){
                  //We don't want to eliminate whitespace on edges.
                  self.query = $(self.editor.getBody()).find('#autocomplete-searchtext').text().replace('\ufeff', '');
                  self.cleanUp(true);
                }, 0);// Make sure the event stops propagating before completing
                return;
            }
            switch (e.which || e.keyCode) {
            //DOWN ARROW
            case 40:
            //UP ARROW
            case 38:
            //SHIFT
            case 16:
            //CTRL
            case 17:
            //ALT
            case 18:
                break;

            //BACKSPACE
            case 8:
                if (this.query === '') {
                    this.cleanUp(true);
                } else {
                    this.lookup();
                }
                break;

            //TAB
            case 9:
            //ENTER
            case 13:
                var item = (this.$dropdown !== undefined) ? this.$dropdown.find('li.active') : [];
                if (item.length) {
                    this.select(item.data());
                    this.cleanUp(false);
                } else {
                    this.cleanUp(true);
                }
                break;

            //ESC
            case 27:
                this.cleanUp(true);
                break;

            default:
                this.lookup();
            }
        },

        rteKeyDown: function (e) {
            switch (e.which || e.keyCode) {
             //TAB
            case 9:
            //ENTER
            case 13:
            //ESC
            case 27:
                e.preventDefault();
                break;

            //UP ARROW
            case 38:
                e.preventDefault();
                if (this.$dropdown !== undefined) {
                    this.highlightPreviousResult();
                }
                break;
            //DOWN ARROW
            case 40:
                e.preventDefault();
                if (this.$dropdown !== undefined) {
                    this.highlightNextResult();
                }
                break;
            }

            e.stopPropagation();
        },

        rteClicked: function (e) {
            var $target = $(e.target);

            if (this.hasFocus && $target.parent().attr('id') !== 'autocomplete-searchtext') {
                this.cleanUp(true);
            }
        },

        rteLostFocus: function () {
            if (this.hasFocus) {
                this.cleanUp(true);
            }
        },

        lookup: function () {
            this.query = $.trim($(this.editor.getBody()).find('#autocomplete-searchtext').text()).replace('\ufeff', '');

            if (this.$dropdown === undefined && !this.isImplicit) {
                this.show();
            }

            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout($.proxy(function () {
                // Added delimiter parameter as last argument for backwards compatibility.
                var items = $.isFunction(this.options.source) ? this.options.source(this.query, $.proxy(this.process, this), this.options.delimiter) : this.options.source;
                if (items) {
                    this.process(items);
                }
            }, this), this.options.delay);
        },

        matcher: function (item) {
            return ~item[this.options.queryBy].toLowerCase().indexOf(this.query.toLowerCase());
        },

        sorter: function (items) {
            var beginswith = [],
                caseSensitive = [],
                caseInsensitive = [],
                item;

            while ((item = items.shift()) !== undefined) {
                if (!item[this.options.queryBy].toLowerCase().indexOf(this.query.toLowerCase())) {
                    beginswith.push(item);
                } else if (~item[this.options.queryBy].indexOf(this.query)) {
                    caseSensitive.push(item);
                } else {
                    caseInsensitive.push(item);
                }
            }

            return beginswith.concat(caseSensitive, caseInsensitive);
        },

        highlighter: function (text) {
            return text.replace(new RegExp('(' + this.query.replace(/([.?*+^$[\]\\(){}|-])/g, '\\$1') + ')', 'ig'), function ($1, match) {
                return '<strong>' + match + '</strong>';
            });
        },

        show: function () {
            var offset = this.editor.inline ? this.offsetInline() : this.offset();

            this.$dropdown = $(this.renderDropdown())
                                .css({ 'top': offset.top, 'left': offset.left });

            $('body').append(this.$dropdown);

            this.$dropdown.on('click', $.proxy(this.autoCompleteClick, this));
        },

        process: function (data) {
            if (!this.hasFocus) {
                return;
            }
            
            if (this.$dropdown === undefined) {
                this.show();
            }

            var _this = this,
                result = [],
                items = $.grep(data, function (item) {
                    return _this.matcher(item);
                });

            items = _this.sorter(items);

            items = items.slice(0, this.options.items);

            $.each(items, function (i, item) {
                var $element = $(_this.render(item));

                $element.html($element.html().replace($element.text(), _this.highlighter($element.text())));

                $.each(items[i], function (key, val) {
                    $element.attr('data-' + key, val);
                });

                result.push($element[0].outerHTML);
            });

            if (result.length) {
                this.$dropdown.html(result.join('')).show();
            } else {
                this.$dropdown.hide();
            }
        },

        renderDropdown: function () {
            return '<ul class="rte-autocomplete dropdown-menu"><li class="loading"></li></ul>';
        },

        render: function (item) {
            return '<li>' +
                        '<a href="javascript:;"><span>' + item[this.options.queryBy] + '</span></a>' +
                    '</li>';
        },

        autoCompleteClick: function (e) {
            var item = $(e.target).closest('li').data();
            if (!$.isEmptyObject(item)) {
                this.select(item);
                this.cleanUp(false);
            }
            e.stopPropagation();
            e.preventDefault();
        },

        highlightPreviousResult: function () {
            var currentIndex = this.$dropdown.find('li.active').index(),
                index = (currentIndex === 0) ? this.$dropdown.find('li').length - 1 : --currentIndex;

            this.$dropdown.find('li').removeClass('active').eq(index).addClass('active');
        },

        highlightNextResult: function () {
            var currentIndex = this.$dropdown.find('li.active').index(),
                index = (currentIndex === this.$dropdown.find('li').length - 1) ? 0 : ++currentIndex;

            this.$dropdown.find('li').removeClass('active').eq(index).addClass('active');
        },

        select: function (item) {
            this.editor.focus();
            var selection = this.editor.dom.select('span#autocomplete')[0];
            // Check if selection is already tagged
            if ($(selection).parent().hasClass('content-tag')){
                // Expand selection to tag span too if so
                selection = selection.parentNode;
            }
            this.editor.dom.remove(selection);
            this.editor.execCommand('mceInsertContent', false, this.insert(item));
        },

        //Insert will no longer be a configurable item
        insert: function (item) {
            return    '<span class="content-tag" style="color: blue">' 
                    +   item[this.options.queryBy] 
                    + '</span>&nbsp;';
        },

        cleanUp: function (rollback) {
            this.unbindEvents();
            this.hasFocus = false;

            if (this.$dropdown !== undefined) {
                this.$dropdown.remove();
                delete this.$dropdown;
            }

            if (rollback) {
                // Make sure the most up to date query is accurate.
                var text = this.query,
                    $selection = $(this.editor.dom.select('span#autocomplete')),
                    delimiter = this.isImplicit ? "" : this.options.delimiter,
                    replacement = $('<p>' + delimiter + text + '</p>')[0].firstChild,
                    focus = $(this.editor.selection.getNode()).offset().top === ($selection.offset().top + (($selection.outerHeight() - $selection.height()) / 2));

                this.editor.dom.replace(replacement, $selection[0]);

                if (focus) {
                    this.editor.selection.select(replacement);
                    this.editor.selection.collapse();
                }
            }
        },

        offset: function () {
            var rtePosition = $(this.editor.getContainer()).offset(),
                contentAreaPosition = $(this.editor.getContentAreaContainer()).position(),
                nodePosition = $(this.editor.dom.select('span#autocomplete')).position();

            return {
                top: rtePosition.top + contentAreaPosition.top + nodePosition.top + $(this.editor.selection.getNode()).innerHeight() - $(this.editor.getDoc()).scrollTop() + 5,
                left: rtePosition.left + contentAreaPosition.left + nodePosition.left
            };
        },

        offsetInline: function () {
            var nodePosition = $(this.editor.dom.select('span#autocomplete')).offset();

            return {
                top: nodePosition.top + $(this.editor.selection.getNode()).innerHeight() + 5,
                left: nodePosition.left
            };
        }

    };

    tinymce.create('tinymce.plugins.Mention', {

        init: function (ed) {

            var autoComplete,
                autoCompleteData = ed.getParam('mentions');

            // If the delimiter is undefined set default value to ['@'].
            // If the delimiter is a string value convert it to an array. (backwards compatibility)
            autoCompleteData.delimiter = (autoCompleteData.delimiter !== undefined) ? !$.isArray(autoCompleteData.delimiter) ? [autoCompleteData.delimiter] : autoCompleteData.delimiter : ['@'];

            var tracker = new Tracker(ed, autoCompleteData);

            function prevCharIsSpace() {
                var start = ed.selection.getRng(true).startOffset,
                      text = ed.selection.getRng(true).startContainer.data || '',
                      charachter = text.substr(start - 1, 1);

                return (!!$.trim(charachter).length) ? false : true;
            }

            ed.on('keypress', function (e) {
                var delimiterIndex = $.inArray(String.fromCharCode(e.which || e.keyCode), autoCompleteData.delimiter);
                if (delimiterIndex > -1 && prevCharIsSpace()) {
                    if (autoComplete === undefined || (autoComplete.hasFocus !== undefined && !autoComplete.hasFocus)) {
                        e.preventDefault();
                        // Clone options object and set the used delimiter.
                        autoComplete = new AutoComplete(ed, $.extend({}, autoCompleteData, { delimiter: autoCompleteData.delimiter[delimiterIndex] }));
                    }
                }
            });

            ed.on('keyup', function(){
              tracker.check();
            });
        },

        getInfo: function () {
            return {
                longname: 'mention',
                author: 'Steven Devooght',
                version: tinymce.majorVersion + '.' + tinymce.minorVersion
            };
        }
    });

    tinymce.PluginManager.add('mention', tinymce.plugins.Mention);

}(tinymce, jQuery));