import {Icon, Box, Button, TextButton, Text, RecordCard, SelectButtons, initializeBlock, useRecordActionData, useBase, useRecordById, useRecords, expandRecord} from '@airtable/blocks/ui';
import React, { useState, createContext, useContext, useRef } from "react";

import './style.css';

const RESPONSES_TABLE = "tblXy0hiHoda5UVSR";
const REJECTED_CHANGES_TABLE = "tblLykRU1MNNAHv7f";
const IGNORE_CONFLICT_MIN = 10;

const ctx = createContext();

function ConflictWarning({recordType, responseTimestamp, lastModifiedTimestamp}) {
  const now = new Date();
  // Check if the record was modified after the response was submitted.
  // Allow for a few minutes of buffer to avoid showing this warning the moment
  // a suggestion is approved.
  if (lastModifiedTimestamp > responseTimestamp &&
      (now - lastModifiedTimestamp) > 1000 * 60 * IGNORE_CONFLICT_MIN) {
    return(
      <p className="conflict_warning">
        This {recordType} record has been modified since the responses below
        were received. The changes suggested below may be out of date
      </p>
    );
  }
  return null;
}

function Change({field, change, targetTable, targetRecord, rejectTable, linkedHousingRec, housingLinkField}) {
  const oldRender = (
    <>
      <span className="remove">
        {formatFieldValue(field, change.existing)}
      </span>
      &nbsp;
    </>
  );
  return (
    <div className="change">
      <Button className="reject" size="small" icon="x" variant="danger" aria-label="Reject" onClick={() => {
        rejectTable.createRecordAsync({"KEY": change.key})
      }} />
      <Button className="approve" size="small" icon="thumbsUp" variant="primary" aria-label="Approve" onClick={() => {
        // convertForField(field, newVal);
        if (targetRecord) {
          targetTable.updateRecordAsync(targetRecord, {[field.name]: convertForField(field, change.updated)});
        } else {
          targetTable.createRecordAsync({
            'HOUSING_LIST_ID': [{id: linkedHousingRec.id}],
            // Remove field name portion of the change key so it applies to the
            // unit record as a whole.
            'TEMP_ID': change.key.split(':').slice(0, 3).join(':'),
            [field.name]: convertForField(field, change.updated)});
        }
      }} />
      <strong>{field.name}</strong>:&nbsp;
      {change.existing ? oldRender : ""}
      <span className="add">
        {formatFieldValue(field, change.updated)}
      </span>
    </div>
  );
}

function BaseUnit({header, responseTimestamp, lastModifiedTimestamp, card, children}) {
  return (
    <div className="unit">
      <h3>{header}</h3>
      <ConflictWarning
        recordType="unit"
        responseTimestamp={responseTimestamp}
        lastModifiedTimestamp={lastModifiedTimestamp} />
      {card}
      {children}
    </div>
  );
}

function DeletedUnit({deletedId, fieldMap, unitsTable, rejectTable, units, changeKey, responseTimestamp}) {
  const header = (
    <TextButton onClick={() => expandRecord(units[deletedId])} icon="expand">
      {`Unit ID ${deletedId}`}
    </TextButton>
  );
  let card = <p>Deleting...</p>;
  let lastModified = 0;
  if (units[deletedId]) {
    lastModified = new Date(
      units[deletedId].getCellValue("LAST_MODIFIED_DATETIME"));
    card = <RecordCard
      className="unit_record_card"
      record={units[deletedId]}
      fields={[
        fieldMap["TYPE"],
        fieldMap["PERCENT_AMI"],
        fieldMap["RENT_PER_MONTH_USD"],
      ]}
    />;
  }
  return (
    <BaseUnit header={header} card={card} responseTimestamp={responseTimestamp} lastModifiedTimestamp={lastModified} >
      <div className="change">
        <Button style={{display: "none"}} size="small" icon="x" variant="danger" aria-label="Reject" onClick={() => {
          // TODO: If a unit deletion is rejected and there are also edits
          // to the type, status, or occupancy, how do we apply those changes
          // after the rejection?  For now, hide the reject option until that
          // gets figured out.
          rejectTable.createRecordAsync({"KEY": `${changeKey}:DELETE`})
        }} />
        <Button size="small" icon="thumbsUp" variant="primary" aria-label="Approve" onClick={() => {
          unitsTable.deleteRecordAsync(units[deletedId]);
        }} />
        <span className="remove_highlight">Delete this unit record</span>
      </div>
    </BaseUnit>
  );
}

function Unit({unit, fieldMap, unitsTable, rejectTable, linkedHousingRec, units, responseTimestamp}) {
  const containerRef = useRef(null);
  let unitHeading = <span className="add_highlight">New Unit</span>;
  let card = null;
  let lastModified = 0;
  if (unit.ID) {
    unitHeading = (
      <TextButton onClick={() => expandRecord(units[unit.ID])} icon="expand">
        {`Unit ID ${unit.ID}`}
      </TextButton>
    );
    card = <RecordCard
      className="unit_record_card"
      record={units[unit.ID]}
      fields={[
        fieldMap["TYPE"],
        fieldMap["PERCENT_AMI"],
        fieldMap["RENT_PER_MONTH_USD"],
      ]}
    />;
    lastModified = new Date(
      units[unit.ID].getCellValue("LAST_MODIFIED_DATETIME"));
  }
  if (!Object.keys(unit.changes).length) {
    return null;
  }
  // TODO: "approve all" will create new records for each field in a new unit
  // instead of only creating a new record for the first field and then applying
  // subsequent fields to that new record.  This may be because the old method
  // for "approve all" (i.e. click all individual approve buttons programmatically)
  // was too fast.
  return (
    <BaseUnit header={unitHeading} card={card} responseTimestamp={responseTimestamp} lastModifiedTimestamp={lastModified}>
      <div ref={containerRef}>
      {Object.keys(unit.changes).toSorted().map(fieldName => {
        const change = unit.changes[fieldName];
        return <Change
          key={change.key}
          field={fieldMap[fieldName]}
          change={change}
          targetTable={unitsTable}
          targetRecord={units[unit.ID]}
          rejectTable={rejectTable}
          linkedHousingRec={linkedHousingRec}
          housingLinkField={fieldMap['HOUSING_LIST_ID']}
        />
      })}
      </div>
    </BaseUnit>
  );
}

function Metadata({response, housing, rejectTable}) {
  let userRender = "";
  let notesRender = "";
  if (response.rawJson.user_name) {
    userRender = (
      <>
        <strong>Submitted by</strong> {response.rawJson.user_name}<br/>
      </>
    );
  }
  if (response.notes.value) {
    notesRender = (
      <>
      <span className="notes">
        <strong>Notes to reviewer</strong> <Text style={{whiteSpace: 'pre-wrap'}} as="span">"{response.notes.value}"</Text>
      &nbsp;
      <TextButton onClick={() => {
        rejectTable.createRecordAsync({"KEY": response.notes.key})
      }}>
        Acknowledge & hide notes
      </TextButton>
      </span>
      <br/>
      </>
    );
  }
  const now = new Date();
  const durationSec = (now - response.timestamp) / 1000;
  let durationStr = '';
  if (durationSec < 60) {
    durationStr = `${durationSec.toFixed(0)}s`;
  } else if (durationSec < 60 * 60) {
    durationStr = `${(durationSec / 60).toFixed(0)}min`;
  } else if (durationSec <  60 * 60 * 24) {
    durationStr = `${(durationSec / (60 * 60)).toFixed(0)}hr`;
  } else if (durationSec <  60 * 60 * 24 * 30.4167) {
    durationStr = `${(durationSec / (60 * 60 * 24)).toFixed(0)}d`;
  } else if (durationSec <  60 * 60 * 24 * 30.4167 * 12) {
    durationStr = `${(durationSec / (60 * 60 * 24 * 30.4167)).toFixed(0)}mo`;
  } else {
    durationStr = `${(durationSec / (60 * 60 * 24 * 30.4167 * 12)).toFixed(0)}yr`;
  }
  return (
    <>
    <strong>ID</strong> {response.housing.ID}<br/>
    <strong>Display ID</strong> {housing[response.housing.ID].getCellValueAsString("DISPLAY_ID")}<br/>
    {userRender}
    <strong>Submitted on</strong> {response.timestamp.toLocaleString()} ({durationStr} ago)<br/>
    {notesRender}
    </>
  );
}

function Apartment({response, housing, units, fieldMap, unitsFieldMap, housingTable, unitsTable, rejectTable}) {
  if (!aptHasChanges(housing, response)) {
    return null;
  }
  const lastModified = new Date(
    housing[response.housing.ID].getCellValue("LAST_MODIFIED_DATETIME"));
  return (
    <div className="apartment">
      <h2>
        <TextButton onClick={() => {
          expandRecord(housing[response.housing.ID]);
        }} icon="expand" size="xlarge">
          {housing[response.housing.ID].getCellValueAsString("APT_NAME")}
        </TextButton>
      </h2>
      <ConflictWarning
        recordType="apartment"
        responseTimestamp={response.timestamp}
        lastModifiedTimestamp={lastModified} />
      <Metadata response={response} housing={housing} rejectTable={rejectTable} />
      {Object.keys(response.housing.changes).toSorted().map(fieldName => {
        const change = response.housing.changes[fieldName];
        return (
          <Change
            key={change.key}
            field={fieldMap[fieldName]}
            change={change}
            targetTable={housingTable}
            targetRecord={housing[response.housing.ID]}
            rejectTable={rejectTable}
          />
        );
      })}
      {response.units.map(unit => {
        return <Unit
          unit={unit}
          fieldMap={unitsFieldMap}
          unitsTable={unitsTable}
          rejectTable={rejectTable}
          linkedHousingRec={housing[response.housing.ID]}
          units={units}
          responseTimestamp={response.timestamp}
        />
      })}
      {getDeletedUnitIds(housing, response).map(deletedId => {
        return <DeletedUnit
          key={deletedId}
          deletedId={deletedId}
          fieldMap={unitsFieldMap}
          unitsTable={unitsTable}
          rejectTable={rejectTable}
          units={units}
          changeKey={`${response.responseRecordId}:${response.housing.ID}:${deletedId}`}
          responseTimestamp={response.timestamp}
        />
      })}
    </div>
  );
}

// Checks if all the fields in a form response object are empty.
// Empty arrays, empty objects, and empty strings are considered empty.
function isEmpty(obj) {
  let empty = true;
  for (const key in obj) {
    let value = obj[key];
    if (typeof value === "object") {
      empty = isEmpty(value);
    }
    else {
      empty = !value;
    }
    if (!empty) {
      break;
    }
  }
  return empty;
}

// Checks if two field values are equal.
// This function is required due to differences in how data
// is stored in Airtable and transmitted via the housing updates
// web form.  For example, Airtable stores phone numbers like
// (xxx) xxx-xxx but the web form supports many phone number
// formats, e.g. xxx-xxx-xxxx.
function fieldValuesEqual(field, existingVal, updatedVal) {
  let existing = existingVal;
  let updated = updatedVal;
  if (field.type == "phoneNumber") {
    function standardizePhoneStr(val) {
      return val.replace(/[\s-()]/g, "");
    }
    existing = standardizePhoneStr(existing);
    updated = standardizePhoneStr(updated);
  } else if (field.type == "checkbox") {
    function standardizeCheckboxStr(val) {
      if (!val) {
        return "unchecked";
      }
      return "checked";
    }
    existing = standardizeCheckboxStr(existing);
    updated = standardizeCheckboxStr(updated);
  } else if(field.type == "number") {
    function standardizeNumberStr(val) {
      return parseFloat(val).toFixed(field.options.precision);
    }
    existing = standardizeNumberStr(existing);
    updated = standardizeNumberStr(updated);
  } else if (field.type == "multipleSelects") {
    function standardizeMultipleSelectsStr(val) {
      if (Array.isArray(val)) {
        return val.sort().join(", ");
      } else {
        let selectedArray = val.split(", ")
        return selectedArray.map(x => x.trim()).sort().join(", ");
      }
    }
    existing = standardizeMultipleSelectsStr(existingVal);
    updated = standardizeMultipleSelectsStr(updatedVal);
  } else if (field.type == "singleLineText" || field.type == "multilineText") {
    function standardizeStr(val) {
      return val.replace(/\s+/g, " ");
    }
    existing = standardizeStr(existing);
    updated = standardizeStr(updated);
  }
  return existing.trim() === updated.trim();
}

// Converts a string value to the proper type for writing to a field
function convertForField(field, val) {
  const strVal = val.toString();
  const converted = field.convertStringToCellValue(strVal);
  if (converted === null && strVal) {
    throw(
      `Error converting ${JSON.stringify(val)} for storage in ${field.name}`);
  }
  return converted;
}

// Formats a field value for printing and display.
function formatFieldValue(field, val) {
  if (field.type == "checkbox") {
    if (val) {
      //return "&#9745"
      return "yes";
    } else {
      //return "&#9744"
      return "no";
    }
  } else if (field.type == "phoneNumber") {
    const digits = val.replace(/[^\d]/g, "");
    if (digits.length == 10) {
      return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 10)}`;
    } else {
      return val;
    }
  } else if (field.type == "number") {
    let parsed = parseFloat(val);
    if (Number.isNaN(parsed)) {
      return val;
    }
    return parsed.toFixed(field.options.precision);
  } else if (field.type == "multipleSelects") {
    if (Array.isArray(val)) {
      return val.sort().join(", ");
    } else {
      let selectedArray = val.split(", ")
      return selectedArray.map(x => x.trim()).sort().join(", ");
    }
  } else if (field.type == "singleLineText" || field.type == "multilineText") {
    return val.replace(/\r/g, "").replace(/\n/g, "<br/>");
  }
  return val
}

function getDeletedUnitIds(housing, response) {
  // Find any newly deleted units by comparing the unit IDs in the response
  // data with the unit IDs in Airtable for this apartment.
  const existingUnits = housing[response.housing.ID].getCellValue("UNITS");
  let existingUnitIds = [];
  // For some reason getCellValue can return null instead of an empty list of linked records.
  if (existingUnits) {
    existingUnitIds = existingUnits.map(u => u.name);
  }
  let updatedUnitIds = response.units.map(u => u.ID).filter(i => i);
  return existingUnitIds.filter(i => !updatedUnitIds.includes(i));
}

function aptHasChanges(housing, response) {
  let changedUnits = response.units.filter(u => Object.keys(u.changes).length);
  // Even if no changes were submitted, ensure that notes to the reviewer make it into the summary.
  return (Object.keys(response.housing.changes).length > 0 ||
    getDeletedUnitIds(housing, response).length > 0 ||
    changedUnits.length > 0 ||
    response.notes.value != '');
}

function RecordActionDataDemoBlock() {
  // null if no buttons have been clicked, otherwise {recordId, viewId, tableId} corresponding
  // to the last click
  const recordActionData = useRecordActionData();

  if (recordActionData === null) {
    return <Box padding={4}>
      Run this extension by clicking the <b>Approve or Reject Changes</b> button next
      to the updates campaign you are interested in.
    </Box>
  }

  return <RecordActionData data={recordActionData} />;
}

function makeChangeKey(responseId, housingId, unitIdx, fieldName) {
  return `${responseId}:${housingId}:${unitIdx}:${fieldName}`;
}

function RecordActionData({data}) {
  const base = useBase();
  const table = base.getTableByIdIfExists(data.tableId);
  const view = table && table.getViewByIdIfExists(data.viewId);
  const record = useRecordById(view, data.recordId);

  if (!(table && view && record)) {
    return <Box padding={2}>Table, view or record was deleted.</Box>
  }

  const CAMPAIGN = record.getCellValueAsString("Campaign Key");

  // Make some table objects for use later.
  let changesTable = base.getTable(RESPONSES_TABLE);
  let housingDbTable = base.getTable(record.getCellValueAsString("Housing DB ID"));
  let unitsTable = base.getTable(record.getCellValueAsString("Units DB ID"));
  let rejectTable = base.getTable(REJECTED_CHANGES_TABLE);


  // Build the Airtable fields hash maps indexed by field name.
  let housingFieldsByName = {};
  let unitFieldsByName = {};
  for (const field of housingDbTable.fields) {
    housingFieldsByName[field.name] = field;
  }
  for (const field of unitsTable.fields) {
    unitFieldsByName[field.name] = field;
  }

  // Build the housing data hash map indexed by Airtable ID.
  let housing = {};
  let housingRecords = useRecords(housingDbTable);
  for (let record of housingRecords) {
    housing[record.getCellValueAsString("ID")] = record;
  }

  // Build the units data hash map indexed by Airtable ID.
  let units = {};
  let unitsByTempId = {};
  let unitsRecords = useRecords(unitsTable);
  for (let record of unitsRecords) {
    units[record.getCellValueAsString("ID")] = record;
    const tempId = record.getCellValueAsString("TEMP_ID");
    if (tempId) {
      unitsByTempId[tempId] = record;
    }
  }

  // Build the rejected changes list.
  let rejects = [];
  let rejectRecords = useRecords(rejectTable);
  for (const record of rejectRecords) {
    rejects.push(record.getCellValueAsString("KEY"));
  }

  // Get all form responses submitted to date.
  let formResponses = useRecords(changesTable,
    {fields: ["FORM_RESPONSE_JSON", "CAMPAIGN", "FORM_SUBMITTED_DATETIME"],
    // Sort ascending by date added so that newer form responses will
    // overwrite older ones in our processing below.
    sorts: [{field: "DATETIME_ADDED", direction: "asc"}]}
  );

  // Build a map of form responses indexed by Airtable ID.
  let responseData = {};
  for (let record of formResponses) {
    if (record.getCellValueAsString("CAMPAIGN") !== CAMPAIGN) {
      // Only process records matching the campaign of interest.
      continue;
    }
    let datetime = new Date(record.getCellValue("FORM_SUBMITTED_DATETIME"));
    let response = JSON.parse(record.getCellValue("FORM_RESPONSE_JSON"));
    responseData[response.ID] = {housing: {}, units: {}, rawJson: response, responseRecordId: record.id, timestamp: datetime};
    // Un-flatten form response data by nesting offering-level data inside
    // their parent unit and units-level data inside their parent apartment.
    // First, we sort data into apartment, unit, or offering-level.
    for (let formFieldName in response) {
      let [fieldName, unitIdx, offeringIdx] = formFieldName.split(":");
      if (unitIdx === undefined && offeringIdx === undefined) {
        // This is apartment-level data.
        responseData[response.ID].housing[fieldName] = response[formFieldName];
      } else {
        // The unit index is a index used in the form field names to distinguish
        // between identical field names for different unit listings.
        if (!responseData[response.ID].units[unitIdx]) {
          // This unit index has not been processed yet.  Add an entry to the map so
          // it's ready to accept form field values.
          responseData[response.ID].units[unitIdx] = {fields:{}, offerings:{}};
        }
        if (offeringIdx === undefined) {
          // This is unit-level data.
          responseData[response.ID].units[unitIdx].fields[fieldName] = response[formFieldName];
        } else {
          // This is offering-level data.
          // The offering index is a index used in the form field names to distinguish
          // between identical field names for different rent offer listings.
          // TODO: there may be a way to shorten this default object construction using ||
          let offerings = responseData[response.ID].units[unitIdx].offerings;
          if (!offerings[offeringIdx]) {
            // This offering index has not been processed yet.  Add an entry to the map so
            // it's ready to accept form field values.
            // TODO: why no fields property here?
            offerings[offeringIdx] = {};
          }
          offerings[offeringIdx][fieldName] = response[formFieldName];
        }
      }
    }

    // Inject the offering-level data for this existing unit ID into the
    // offerings object to pretend the proposed deletion never happened.
    // Need to figure out which unit to inject it under, or potentially create a new unit?
    // Doing this prior to nesting may be easier...
    // TODO

    // The data entry form has a flat structure, so there are many available "slots"
    // in the form for units.  It's likely that not every set of unit-level fields
    // will be filled. Prune units and offerings to only include those with data.
    // Note we iterate over a separate array of keys rather than the object itself
    // to avoid deleting stuff in the object we are iterating over.
    for (let unitIdx in Object.keys(responseData[response.ID].units)) {
      let unit = responseData[response.ID].units[unitIdx];
      // Remove any empty offerings first.
      for (let offeringIdx in Object.keys(unit.offerings)) {
        if (isEmpty(unit.offerings[offeringIdx])){
          delete unit.offerings[offeringIdx];
        }
      }
      // If the unit has no data left remove it as well.
      if (isEmpty(unit)) {
        delete responseData[response.ID].units[unitIdx];
      }
    }

    // The Airtable data does not nest offerings within units, but rather
    // stores each offering as a separate record in the Units table.  Flatten
    // our units structure here to match.
    let flatUnits = [];
    for (const unitIdx in responseData[response.ID].units) {
      let unit = responseData[response.ID].units[unitIdx];
      // TODO: (fixed...I think) If there are no offerings, nothing gets pushed!!
      if (Object.keys(unit.offerings).length == 0) {
        flatUnits.push(unit.fields);
      } else {
        for (const offeringIdx in unit.offerings) {
          let offering = unit.offerings[offeringIdx];
          let flatUnit = {...unit.fields, ...offering};
          flatUnits.push(flatUnit);
        }
      }
    }

    // Check for any units with a rejected proposal for deletion.
    // TODO: Figure out what to do after finding the rejected deletes.
    const rejectedDeletes = rejects.filter(
      r => r.match(new RegExp(`${record.id}:${response.ID}:(\\d+):DELETE`)));
    for (const rejectedDelete of rejectedDeletes) {
      const unitId = rejectedDelete[1];
    }
    responseData[response.ID].units = flatUnits;
  }
  console.log(responseData);

  // Find differences between the form response data and the data stored in
  // Airtable.
  for (let housingId in responseData) {
    //changes[housingId] = {housing:{}, units:[]};
    const notesKey = makeChangeKey(
      responseData[housingId].responseRecordId, housingId, '-', 'userNotes');
    let notesValue = responseData[housingId].rawJson.userNotes;
    if (rejects.includes(notesKey)) {
      notesValue = ''
    }
    responseData[housingId].notes = {
      value: notesValue,
      key: notesKey
    };
    responseData[housingId].housing.changes = {}
    for (let dbField in housingFieldsByName){
      if (!responseData[housingId].housing.hasOwnProperty(dbField)) {
        continue;
      }
      let existingVal = housing[housingId].getCellValueAsString(dbField);
      // change key format is responseID:housingId:unitIdx:fieldName
      const changeKey = makeChangeKey(responseData[housingId].responseRecordId, housingId, '-', dbField);
      let newVal = responseData[housingId].housing[dbField];
      if (rejects.includes(changeKey)) {
        newVal = existingVal;
      }
      if (!fieldValuesEqual(housingFieldsByName[dbField], existingVal, newVal)) {
        responseData[housingId].housing.changes[dbField] = {
          existing: existingVal, updated: newVal, key: changeKey};
      }
    }
    for (let [idx, unit] of responseData[housingId].units.entries()) {
      let unitChanges = {};
      const unitKey = (
        `${responseData[housingId].responseRecordId}:${housingId}:idx${idx}`);
      if (!unit.ID && unitsByTempId[unitKey]) {
        unit.ID = unitsByTempId[unitKey].getCellValueAsString("ID");
      }
      if (unit.ID && !units[unit.ID]) {
        // Unit ID exists in the form response, but does not exist in the DB
        // due to manual deletion.  It should be treated as a new unit.
        unit.ID = "";
      }
      let unitId = unit.ID || ""
      unit.changes = {};
      for (let dbField in unitFieldsByName) {
        if (!unit.hasOwnProperty(dbField)) {
          continue;
        }
        const changeKey = makeChangeKey(
          responseData[housingId].responseRecordId, housingId, `idx${idx}`,
          dbField);
        let existingVal = "";
        if (unitId) {
          existingVal = units[unitId].getCellValueAsString(dbField);
        }
        let newVal = unit[dbField];
        if (rejects.includes(changeKey)) {
          newVal = existingVal;
        }
        // TODO: possibly omit the 'existing' for new entries.
        if (!fieldValuesEqual(unitFieldsByName[dbField], existingVal, newVal)) {
          unit.changes[dbField] = {
            existing: existingVal, updated: newVal, key: changeKey};
        }
      }
    }
  }

  // Get a list of IDs sorted by response timestamp (oldest first).
  const sortedIds = Object.keys(responseData).toSorted((a, b) => {
    return responseData[a].timestamp - responseData[b].timestamp;
  });

  console.log(responseData);

  const aptsToRender = []
  for (const housingId of sortedIds) {
    if (aptHasChanges(housing, responseData[housingId])) {
      aptsToRender.push(
        <Apartment
          key={housingId}
          response={responseData[housingId]}
          housing={housing}
          units={units}
          fieldMap={housingFieldsByName}
          unitsFieldMap={unitFieldsByName}
          housingTable={housingDbTable}
          unitsTable={unitsTable}
          rejectTable={rejectTable}
        />
      );
    }
  }
  if (aptsToRender.length > 0) {
    return (
      <Box padding={4} style={{height: "100vh", width: "100%"}}>
        {aptsToRender}
      </Box>
    );
  } else {
    return <Box padding={4}>No changes found, nothing to display.</Box>
  }
}

initializeBlock(() => <RecordActionDataDemoBlock />);