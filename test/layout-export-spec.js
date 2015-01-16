/* global jasmine, beforeEach, it, describe, expect, jQuery, spyOn,  MM, _*/
describe('LayoutExport', function () {
	'use strict';
	describe('LayoutExportController', function () {
		var configurationGenerator, exportFunctions, currentLayout, underTest, requestId, storageApi, activityLog, saveConfiguration, saveOptions,
			laststorageApiCallFor = function (url) {
				return _.find(storageApi.poll.calls.all(), function (call) {
					return call.args[0] === url;
				});
			};
		beforeEach(function () {
			var timer = jasmine.createSpyObj('timer', ['end']),
				buildStorageApi = function () {
				var storageApi = {
					deferred: {}, //jQuery.Deferred(),
					poll: function (url) {
						var deferred = jQuery.Deferred();
						storageApi.deferred[url] = deferred;
						return deferred.promise();
					}
				};

				storageApi.save = jasmine.createSpy('save');
				storageApi.save.and.returnValue(
					jQuery.Deferred().resolve().promise());
				return storageApi;
			};
			requestId = 'AIUHDKUHGDKHUD';
			saveConfiguration = {'signedErrorListUrl': 'errorlisturl', 'signedOutputListUrl': 'outputlisturl', 'signedOutputUrl': 'outputurl', 's3UploadIdentifier': requestId};
			saveOptions = {isPrivate: true};
			configurationGenerator = {};
			exportFunctions = { };
			activityLog = jasmine.createSpyObj('activityLog', ['log', 'timer']);
			activityLog.timer.and.returnValue(timer);
			currentLayout = { 'a': 'b' };
			configurationGenerator.generateExportConfiguration = jasmine.createSpy('saveMap');
			configurationGenerator.generateExportConfiguration.and.returnValue(
				jQuery.Deferred().resolve(saveConfiguration).promise()
			);

			exportFunctions.pdf = jasmine.createSpy('getCurrentLayout');
			exportFunctions.pdf.and.returnValue(currentLayout);
			storageApi = buildStorageApi();
			underTest = new MM.LayoutExportController(exportFunctions, configurationGenerator, storageApi, activityLog);

		});
		it('pulls out current map model layout, passes the format to the configuration generator, and publishes JSON version of that to the storageApi', function () {
			underTest.startExport('pdf');
			expect(configurationGenerator.generateExportConfiguration).toHaveBeenCalledWith('pdf');
			expect(storageApi.save).toHaveBeenCalledWith(JSON.stringify(currentLayout), saveConfiguration, saveOptions);
		});
		it('merges any object passed with the current map model layout, and publishes JSON version of that to an fileSystem, leaving current layout unchanged', function () {
			underTest.startExport('pdf', {'foo': 'bar'});
			expect(storageApi.save).toHaveBeenCalledWith(JSON.stringify({'a': 'b', 'foo': 'bar'}), saveConfiguration, saveOptions);
			expect(currentLayout).toEqual({'a': 'b'});
		});
		it('immediately rejects with an error if the export result is empty', function () {
			var rejected = jasmine.createSpy('rejected');
			exportFunctions.pdf.and.returnValue({});
			underTest.startExport('pdf', {'foo': 'bar'}).fail(rejected);
			expect(storageApi.save).not.toHaveBeenCalled();
			expect(rejected).toHaveBeenCalledWith('empty');
		});
		it('polls for result and error when the request is started', function () {
			spyOn(storageApi, 'poll').and.callThrough();
			underTest.startExport('pdf');
			var outputOptions = storageApi.poll.calls.mostRecent().args[1],
				errorOptions = storageApi.poll.calls.first().args[1];
			expect(outputOptions.sleepPeriod).toEqual(2500);
			expect(errorOptions.sleepPeriod).toEqual(15000);
			expect(storageApi.poll).toHaveBeenCalledWith('outputlisturl', jasmine.any(Object));
			expect(storageApi.poll).toHaveBeenCalledWith('errorlisturl', jasmine.any(Object));
		});

		it('export is marked as not stopped until deferred object is resolved', function () {
			spyOn(storageApi, 'poll').and.callThrough();
			underTest.startExport('pdf');
			expect(laststorageApiCallFor('outputlisturl').args[1].stoppedSemaphore()).toBeFalsy();
		});
		it('export is marked as stopped after promise is resolved', function () {
			spyOn(storageApi, 'poll').and.callThrough();
			underTest.startExport('pdf');
			storageApi.deferred.outputlisturl.resolve('foo');
			expect(laststorageApiCallFor('errorlisturl').args[1].stoppedSemaphore()).toBeTruthy();
		});
		it('resolves promise with signed output url when the storageApi resolves', function () {
			var resolved = jasmine.createSpy('resolved');

			underTest.startExport('pdf').then(resolved);

			storageApi.deferred.outputlisturl.resolve();
			expect(resolved).toHaveBeenCalledWith('outputurl', requestId);
		});
		it('rejects if the configuationGenerator fails', function () {
			var fail = jasmine.createSpy('fail'),
				reason = 'cos i cant get the config';
			configurationGenerator.generateExportConfiguration.and.returnValue(jQuery.Deferred().reject(reason).promise());
			spyOn(storageApi, 'poll').and.callThrough();

			underTest.startExport('pdf').fail(fail);

			expect(fail).toHaveBeenCalledWith(reason, undefined);
			expect(storageApi.poll).not.toHaveBeenCalled();
		});
		it('rejects if the error storageApi poll resolves before the result storageApi poll', function () {
			var resolved = jasmine.createSpy('resolved'),
				url = 'http://www.google.com',
				fail = jasmine.createSpy('fail');

			underTest.startExport('pdf').then(resolved, fail);

			storageApi.deferred.errorlisturl.resolve('www.fail.com');
			storageApi.deferred.outputlisturl.resolve(url);

			expect(resolved).not.toHaveBeenCalled();
			expect(fail).toHaveBeenCalledWith('generation-error', requestId);
		});
		it('rejects promise if the storageApi rejects', function () {
			var fail = jasmine.createSpy('fail'),
				reason = 'cos i said so';

			underTest.startExport('pdf').fail(fail);

			storageApi.deferred.outputlisturl.reject(reason);
			expect(fail).toHaveBeenCalledWith(reason, requestId);
		});
		it('rejects promise if the file system rejects', function () {
			var fail = jasmine.createSpy('fail'),
				reason = 'cos i said so';
			storageApi.save.and.returnValue(jQuery.Deferred().reject(reason).promise());
			spyOn(storageApi, 'poll').and.callThrough();

			underTest.startExport('pdf').fail(fail);

			expect(fail).toHaveBeenCalledWith(reason, undefined);
			expect(storageApi.poll).not.toHaveBeenCalled();
		});
	});
});
describe('MM.buildMapLayoutExporter', function () {
	'use strict';
	var underTest, mapModel, resourceTranslator;
	beforeEach(function () {
		mapModel = jasmine.createSpyObj('mapModel', ['getCurrentLayout']);
		resourceTranslator = function (x) { return 'get+' + x; };
		underTest = MM.buildMapLayoutExporter(mapModel, resourceTranslator);
	});
	it('replaces all icon URLs in the layout nodes with resource URLs', function () {
		mapModel.getCurrentLayout.and.returnValue({nodes: { 1: { title: 'first', attr: {icon: { url: 'x1'}}}, 2: {title: 'no icon'}, 3: { title: 'another', attr: {icon: { url: 'x2'}}}}});
		expect(underTest()).toEqual({nodes: { 1: { title: 'first', attr: {icon: { url: 'get+x1'}}}, 2: {title: 'no icon'}, 3: { title: 'another', attr: {icon: { url: 'get+x2'}}}}});
	});
	it('survives no nodes', function () {
		mapModel.getCurrentLayout.and.returnValue({links: []});
		expect(underTest()).toEqual({links: []});
	});
});
