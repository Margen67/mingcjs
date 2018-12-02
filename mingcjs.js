
function cs_mempool_create(_options) {
    const KILOBYTE = 1024;

    _options = _options || {
    };
    _options.ERROR_HANDLER = _options.ERROR_HANDLER || (function(e) {
        throw new Error(e);
    });

    const {__global__, is_worker} = (function() {

        if(typeof self !== "undefined") {
            return {__global__:self, is_worker : true};
        }
        else if(typeof window !== "undefined") {
            return {__global__:window, is_worker: false};
        }
        else {
            if(typeof global === "undefined") {
                _options.ERROR_HANDLER("WE HAVE NO IDEA WHAT WE ARE.");

            }
            return {__global__:global, is_worker:false};
        }
    })();

    /*
        chrome is the only engine that does frozen object optimization afaik, and only recent versions like 60+ish?
     */
    const FREEZING_OBJECTS_IMPROVES_PERFORMANCE = typeof __global__ === typeof global ||
        !!~navigator.userAgent.indexOf("Chrome");

    const _freeze = (function() {
        return FREEZING_OBJECTS_IMPROVES_PERFORMANCE ?
            Object.freeze : (function(v) {
                return v;
            });
    })();
    _options.GP_MEM_SIZE = _options.GP_MEM_SIZE || KILOBYTE*128;

    _options.STACK_SIZE =  _options.STACK_SIZE || 32 * KILOBYTE;


    _options.MEM_ARRAYBUFFER_VIEW_START = _options.MEM_ARRAYBUFFER_VIEW_START || 0;

    /*
        realign to 8-byte boundary so all array views that may be used can have the same start and end
     */
    if(_options.MEM_ARRAYBUFFER_VIEW_START & 7 ) {
        _options.MEM_ARRAYBUFFER_VIEW_START += 8;
        _options.MEM_ARRAYBUFFER_VIEW_START &= ~7;
    }


    _options.MEM_ARRAYBUFFER_VIEW_END = _options.MEM_ARRAYBUFFER_VIEW_END || 0;
    if(_options.MEM_ARRAYBUFFER_VIEW_END & 7 ) {
        //align downwards to 8 byte boundary
        _options.MEM_ARRAYBUFFER_VIEW_END &= ~7;
    }


    const options = _freeze(_options);







    const __clz32 = (function() {
        const _clz32 = Math.clz32;

        return function(v) {
            return _clz32(v|0);
        };
    })();


    const has_sab = typeof __global__["SharedArrayBuffer"] !== "undefined" && (!options.MEM_ARRAYBUFFER || options.MEM_ARRAYBUFFER instanceof SharedArrayBuffer);

    const has_bigint64 = typeof __global__["BigInt64Array"] !== "undefined";

    class cs_list_element_t {
        constructor(data) {
            this._data = data;
            this._next = null;
        }

        is_tail() {
            return !this._next;
        }

        data() {
            return this._data;
        }

        next() {
            return this._next;
        }

        _set_next(ele) {
            this._next = ele;
        }

        destroy() {
            this.data = null;
            this._set_next(null);
        }
    }


    function cs_list(element_constructor) {


        class cs_list_t {
            constructor() {
                this._size = 0;
                this._head = this._tail = null;
            }

            size() {
                return this._size;
            }

            head() {
                return this._head;
            }

            tail() {
                return this._tail;
            }

            _set_tail(ele) {
                this._tail = ele;
            }

            _set_head(ele) {
                this._head = ele;
            }

            _set_size(sz) {
                this._size = sz;
            }

            insertNext(ele, ...rest) {

                let newData;
                if (typeof rest[0] === 'object') {
                    newData = rest[0];
                }
                else {
                    newData = new element_constructor(...rest);
                }
                let newElement = new cs_list_element_t(newData);
                //list head
                if (ele == null) {
                    if (this.size() == 0)
                        this._set_tail(newElement);
                    newElement._set_next(this.head());
                    this._set_head(newElement);
                }
                else {
                    if (ele.is_tail())
                        this._set_tail(newElement);
                    newElement._set_next(ele.next());
                    ele._set_next(newElement);
                }
                this._set_size(this.size() + 1);
            }

            destroy() {
                while (this.size() > 0) {
                    this.removeNext(null);
                }
            }

            removeNext(ele) {
                if (this.size() == 0) {
                    return;
                }
                let data;
                let old;
                //head
                if (ele == null) {
                    old = this.head();
                    data = old.data();
                    this._set_head(old.next());
                    if (this.size() == 1) {
                        this._set_tail(null);
                    }
                }
                else {
                    if (ele.is_tail()) {
                        return;
                    }
                    old = ele.next();
                    ele._set_next(old.next());
                    if (ele.next() == null) {
                        this._set_tail(ele);
                    }
                }
                old.destroy();
                this._set_size(this.size() - 1);
            }
        }

        return cs_list_t;
    }

    class cs_page_t {
        constructor(offset, size) {

            this._size = size >>> 0;
            this._claimed = false;

            this._offset = (offset >>> 0);


        }

        size() {
            return this._size;
        }

        claimed() {
            return this._claimed;
        }

        _set_size(value) {
            this._size = value;
        }

        _set_claimed(value) {
            this._claimed = value;
        }

        offset() {
            return this._offset >>> 0;
        }

        _set_offset(offs) {
            this._offset = offs >>> 0;
        }
    }

    const page_list_t = cs_list(cs_page_t);

    class cs_pool_t {
        constructor(nbytes) {
            nbytes = (nbytes + 8) & (~(8 - 1));
            let b;
            if(!options.MEM_ARRAYBUFFER)
                b = (this.buffer = new (has_sab ? SharedArrayBuffer : ArrayBuffer)(nbytes));
            else
                b = this.buffer = options.MEM_ARRAYBUFFER;

            function construct_view(type) {
                if((options.MEM_ARRAYBUFFER_VIEW_END | options.MEM_ARRAYBUFFER_VIEW_START) !== 0) {
                    return new type(b,options.MEM_ARRAYBUFFER_VIEW_START,  (options.MEM_ARRAYBUFFER_VIEW_END - options.MEM_ARRAYBUFFER_VIEW_START) / type.BYTES_PER_ELEMENT)
                }
                else {
                    return new type(b);
                }
            }



            this.u8 = construct_view(Uint8Array);
            this.u16 = construct_view(Uint16Array);
            this.u32 = construct_view(Uint32Array);
            this.i8 = construct_view(Int8Array);
            this.i16 = construct_view(Int16Array);
            this.i32 = construct_view(Int32Array);
            this.f32 = construct_view(Float32Array);
            this.f64 = construct_view(Float64Array);

            if(has_bigint64) {
                this.i64 = construct_view(BigInt64Array);
                this.u64 = construct_view(BigUint64Array);
            }

            this.pageTable = new page_list_t();
            this.totalAlloc = nbytes;
            this.currentReserved = 0;




            //insert first page
            this.add_page_after(null, 0, nbytes);
        }

        add_page_after(at, offset, size) {
            this.pageTable.insertNext(at, offset, size);
        }

        findPageForSize(nbytes) {
            let pg = this.pageTable.head();
            while (pg != null) {
                let data = pg.data();
                if (!data.claimed() && data.size() >= nbytes) {
                    return pg;
                }
                pg = pg.next();
            }
            return null;
        }

        allocate(nbytes) {
            let found = this.findPageForSize(nbytes);
            if (found) {
                let page = found.data();
                if (page.size() > nbytes) {
                    this.add_page_after(found, page.size() - nbytes + page.offset(), nbytes);
                    page._set_size(page.size() - nbytes);
                    page = found.next().data();
                }
                page._set_claimed(true);
                this.currentReserved += nbytes;
                return page.offset();
            }
            else
                return nullptr;
        }

        free(ptr) {
            let prev = null;
            let pg = this.pageTable.head();
            while (pg != null) {
                let data_1 = pg.data();
                if (data_1.offset() == ptr) {
                    break;
                }
                prev = pg;
                pg = pg.next();
            }
            if (pg == null) {
                throw Error("Bad pointer passed to freePage.");
            }
            let data = pg.data();
            this.currentReserved -= data.size();
            if (!pg.is_tail()) {
                let next = pg.next();
                if (!next.data().claimed()) {
                    data._set_size(data.size() + next.data().size());
                    this.pageTable.removeNext(pg);
                }
            }
            data._set_claimed(false);
            if (prev != null && !prev.data().claimed()) {
                let prevData = prev.data();
                prevData._set_size(data.size() + prevData.size());
                this.pageTable.removeNext(prev);
            }
        }

        size() {
            return this.totalAlloc;
        }

        nalloc() {
            return this.currentReserved;
        }

        destroy() {
            this.pageTable.destroy();
        }
    }


    const nullptr = 0;



    const GP_MEM_SIZE = options.GP_MEM_SIZE;
    const STACK_SIZE = options.STACK_SIZE;

    if(GP_MEM_SIZE + STACK_SIZE > options.MEM_ARRAYBUFFER_VIEW_END - options.MEM_ARRAYBUFFER_VIEW_START &&
        (options.MEM_ARRAYBUFFER_VIEW_END | options.MEM_ARRAYBUFFER_VIEW_START) !== 0) {

        options.ERROR_HANDLER("Specified start and end for arraybuffer view cannot accommodate required size in bytes given in options.");
    }

    const TOTAL_MEMORY_SIZE = GP_MEM_SIZE + STACK_SIZE < options.MEM_ARRAYBUFFER_VIEW_END - options.MEM_ARRAYBUFFER_VIEW_START ?
        options.MEM_ARRAYBUFFER_VIEW_END - options.MEM_ARRAYBUFFER_VIEW_START
        : GP_MEM_SIZE + STACK_SIZE;

    const GLOBAL_MEMORY = new cs_pool_t(TOTAL_MEMORY_SIZE );
    //offset stack by 8 so very start is not nullptr
    const STACK_BASE = GLOBAL_MEMORY.allocate(STACK_SIZE + 8) + 8;


    const glbu8 = GLOBAL_MEMORY.u8;
    const glbi8 = GLOBAL_MEMORY.i8;
    const glbu16 = GLOBAL_MEMORY.u16;
    const glbi16 = GLOBAL_MEMORY.i16;
    const glbu32 = GLOBAL_MEMORY.u32;
    const glbi32 = GLOBAL_MEMORY.i32;
    const glbf32 = GLOBAL_MEMORY.f32;
    const glbf64 = GLOBAL_MEMORY.f64;

    const glbu64 = has_bigint64 ? GLOBAL_MEMORY.u64 : null;
    const glbi64 = has_bigint64 ? GLOBAL_MEMORY.i64 : null;







    const {stack_frame_begin, stack_frame_end} = (function () {

        let _sp = STACK_BASE >>> 0;

        class cached_sp_t {
            constructor() {
                this.old_base = 0 >>> 0;
                this.sp = 0 >>> 0;
            }
        }

        const __sp_res = new cached_sp_t();

        function stack_frame_begin(size) {

            __sp_res.old_base = _sp >>> 0;

            _sp += 8 >>> 0;
            _sp &= (~7) >>> 0;

            __sp_res.sp = _sp >>> 0;
            _sp += size >>> 0;

            return __sp_res;
        }

        function stack_frame_end(old_base) {
            _sp = old_base >>> 0;
        }

        return {stack_frame_begin, stack_frame_end};
    })();


    const cs_lookaside_list_t = (function () {

        class cs_lookaside_entry_t {
            constructor() {
                this.next = null;
                this.value = 0 >>> 0;

            }
        }

        class cs_lookaside_impl_t {
            _new_entry() {
                const n = this.avail;
                if (!n) {
                    return new cs_lookaside_entry_t();
                }
                else {
                    this.avail = n.next;
                    return n;
                }
            }

            _release_entry(entry) {
                entry.value = 0;
                entry.next = this.avail;
                this.avail = entry;
            }

            constructor(base, end) {
                this.avail = null;
                this.entries = null;
                this.base = base;
                this.end = end;
            }

            insert_head(offset) {
                const entry = this._new_entry();

                entry.value = offset >>> 0;

                entry.next = this.entries;
                this.entries = entry;


            }

            alloc() {
                const result = this.entries;

                const result_val = result.value >>> 0;

                this.entries = result.next;
                this._release_entry(result);
                return result_val;
            }

        }

        return cs_lookaside_impl_t;
    })();




    function build_lookaside_list(sizeof_data, nentries) {

        const LL_BASE = GLOBAL_MEMORY.allocate(sizeof_data*nentries);
        const LL_END = LL_BASE + (sizeof_data*nentries);
        const ll = new cs_lookaside_list_t(LL_BASE, LL_END);
        for(let offset = LL_BASE; offset < LL_END; offset += sizeof_data) {
            ll.insert_head(offset);
        }

        return ll;

    }

    function destroy_lookaside_list(ll) {
        if(ll.base) {
            GLOBAL_MEMORY.deallocate(ll.base);
            ll.avail = null;
            ll.base = nullptr;
            ll.entries = null;
        }
    }


    function allocate(size) {
        return GLOBAL_MEMORY.allocate(size);
    }

    function deallocate(ptr) {
        GLOBAL_MEMORY.free(ptr);
    }

    const FUTEX_WAITED = 0,
        FUTEX_WASNE = 1,
        FUTEX_TIMED_OUT = -1;

    function memcmp(ptr1, ptr2, sz) {
        let offs1 = ptr1;
        let offs2 = ptr2;
        const offsend = offs1 + sz;
        for (; offs1 < offsend; ++offs1, ++offs2)
            if (glbu8[offs1] != glbu8[offs2])
                return false;
        return true;
    }

    function memset(p, value, sz) {
        let ptr = p;
        const end = p + sz;
        for (; ptr < end; ++ptr) {
            glbu8[ptr] = value;
        }
    }

    function zeromem(p, sz) {
        let ptr = p;
        let end = p + sz;

        if(!(p&7)) {
            ptr >>>= 3;
            end >>>= 3;

            for (; ptr < end; ++ptr) {
                glbf64[ptr] = 0;
            }

            ptr <<= 3;
            end <<= 3;
            end += (sz & 7)
        }
        for (; ptr < end; ++ptr) {
            glbu8[ptr] = 0;
        }

    }

    function store_string(p, str) {
        const l = str.length;
        let i = 0;
        let ptr = p;
        for (; i < l; ++i, ++ptr) {
            glbu8[ptr] = str.charCodeAt(i);
        }
        glbu8[ptr+l] = 0;

    }

    function memcopy(p1, p2, sz) {

        if(!((p1 & 3) | (p2 & 3))) {

            let end = (p1 + sz) >>> 2;
            let ptr1 = p1 >>> 2;
            let ptr2 = p2 >>> 2;
            for (; ptr1 < end; ++ptr1, ++ptr2) {
                glbu32[ptr1] = glbu32[ptr2];
            }

            ptr1 <<= 2;
            ptr2 <<= 2;

            end <<= 2;
            end += sz & 3;
            for (; ptr1 < end; ++ptr1, ++ptr2) {
                glbu8[ptr1] = glbu8[ptr2];
            }
            return;

        }
        else if(!((p1 & 1) | (p2 & 1))) {

            let end = (p1 + sz) >>> 1;
            let ptr1 = p1 >>> 1;
            let ptr2 = p2 >>> 1;
            for (; ptr1 < end; ++ptr1, ++ptr2) {
                glbu16[ptr1] = glbu16[ptr2];
            }

            ptr1 <<= 1;
            ptr2 <<= 1;

            end <<= 1;
            end += sz & 1;
            for (; ptr1 < end; ++ptr1, ++ptr2) {
                glbu8[ptr1] = glbu8[ptr2];
            }
            return;
        }
        else {
            const end = p1 + sz;
            let ptr1 = p1;
            let ptr2 = p2;
            for (; ptr1 < end; ++ptr1, ++ptr2) {
                glbu8[ptr1] = glbu8[ptr2];
            }
        }
    }

    const fp16_convert = (function() {

        /*
            found this one on stack overflow: https://stackoverflow.com/questions/32633585/how-do-you-convert-to-half-floats-in-javascript
         */
        const floatView = new Float32Array(1);
        const int32View = new Int32Array(floatView.buffer);

        return function toHalf( fval ) {
            floatView[0] = fval;
            var fbits = int32View[0];
            var sign  = (fbits >> 16) & 0x8000;          // sign only
            var val   = ( fbits & 0x7fffffff ) + 0x1000; // rounded value

            if( val >= 0x47800000 ) {             // might be or become NaN/Inf
                if( ( fbits & 0x7fffffff ) >= 0x47800000 ) {
                    // is or must become NaN/Inf
                    if( val < 0x7f800000 ) {          // was value but too large
                        return sign | 0x7c00;           // make it +/-Inf
                    }
                    return sign | 0x7c00 |            // remains +/-Inf or NaN
                        ( fbits & 0x007fffff ) >> 13; // keep NaN (and Inf) bits
                }
                return sign | 0x7bff;               // unrounded not quite Inf
            }
            if( val >= 0x38800000 ) {             // remains normalized value
                return sign | val - 0x38000000 >> 13; // exp - 127 + 15
            }
            if( val < 0x33000000 )  {             // too small for subnormal
                return sign;                        // becomes +/-0
            }
            val = ( fbits & 0x7fffffff ) >> 23;   // tmp exp for subnormal calc
            return sign | ( ( fbits & 0x7fffff | 0x800000 ) // add subnormal bit
                + ( 0x800000 >>> val - 102 )     // round depending on cut off
                >> 126 - val );                  // div by 2^(1-(exp-127+15)) and >> 13 | exp=0
        };
    }());

    /*
    also from stack overflow : https://stackoverflow.com/questions/5678432/decompressing-half-precision-floats-in-javascript
     */
    function decode_fp16 (binary) {
        var exponent = (binary & 0x7C00) >> 10,
            fraction = binary & 0x03FF;

        return (binary >> 15 ? -1 : 1) * (
            exponent ?
                (
                    exponent === 0x1F ?
                        fraction ? NaN : Infinity :
                        Math.pow(2, exponent - 15) * (1 + fraction / 0x400)
                ) :
                6.103515625e-5 * (fraction / 0x400)
        );
    }

    function read_string(p) {

        let str = "";

        for(let i = 0; glbu8[i+p]; ++i) {
            str += String.fromCharCode(glbu8[i+p]);
        }

        return str;



    }



    function write_u8(ptr, value) {
        glbu8[ptr] = value;
    }

    function read_u8(ptr) {
        return glbu8[ptr];
    }

    function write_i8(ptr, value) {
        glbi8[ptr] = value;
    }

    function read_i8(ptr) {
        return glbi8[ptr];
    }

    function write_u16(ptr, value) {
        glbu16[ptr >>> 1] = value;
    }

    function write_i16(ptr, value) {
        glbi16[ptr >>> 1] = value;
    }

    function read_u16(ptr) {
        return glbu16[ptr >>> 1];
    }

    function read_i16(ptr) {
        return glbi16[ptr >>> 1];
    }


    function write_u32(ptr, value) {
        glbu32[ptr >>> 2] = value;
    }

    function write_i32(ptr, value) {
        glbi32[ptr >>> 2] = value;
    }

    function read_u32(ptr) {
        return glbu32[ptr >>> 2]
    }

    function read_i32(ptr) {
        return glbi32[ptr >>> 2];
    }

    function iwrite_i8(ptr, index, value) {
        glbi8[ptr  + index] = value;
    }

    function iread_i8(ptr, index) {
        return glbi8[ptr + index];
    }


    function iwrite_u8(ptr, index, value) {
        glbu8[ptr  + index] = value;
    }

    function iread_u8(ptr, index) {
        return glbu8[ptr + index];
    }


    function iwrite_i16(ptr, index, value) {
        glbi16[(ptr >>> 1) + index] = value;
    }

    function iread_i16(ptr, index) {
        return glbi16[(ptr >>> 1) + index];
    }



    function iwrite_u16(ptr, index, value) {
        glbu16[(ptr >>> 1) + index] = value;
    }

    function iread_u16(ptr, index) {
        return glbu16[(ptr >>> 1) + index];
    }

    function iwrite_u32(ptr, index, value) {
        glbu32[(ptr >>> 2) + index] = value;
    }

    function iread_u32(ptr, index) {
        return glbu32[(ptr >>> 2) + index];
    }

    function iwrite_i32(ptr, index, value) {
        glbi32[(ptr >>> 2) + index] = value;
    }

    function iread_i32(ptr, index) {
        return glbi32[(ptr >>> 2) + index];
    }

    function read_f32(ptr) {
        return glbf32[ptr >>> 2];
    }

    function write_f32(ptr, value) {
        glbf32[ptr >>> 2] = value;
    }


    function iwrite_f32(ptr, index, value) {
        glbf32[(ptr >>> 2) + index] = value;
    }

    function iread_f32(ptr, index) {
        return glbf32[(ptr >>> 2) + index];
    }

    function write_f64(ptr, value) {
        glbf64[ptr >>> 3] = value;
    }

    function read_f64(ptr) {
        return glbf64[ptr >>> 3];
    }

    function iwrite_f64(ptr, index, value) {
        glbf64[(ptr >>> 3) + index] = value;
    }

    function iread_f64(ptr, index) {
        return glbf64[(ptr >>> 3) + index];
    }

    function write_i64(ptr, value) {
        glbi64[ptr >>> 3] = value;
    }

    function read_i64(ptr) {
        return glbi64[ptr >>> 3];
    }

    function iwrite_i64(ptr, index, value) {
        glbi64[(ptr >>> 3) + index] = value;
    }

    function iread_i64(ptr, index) {
        return glbi64[(ptr >>> 3) + index];
    }


    function write_u64(ptr, value) {
        glbu64[ptr >>> 3] = value;
    }

    function read_u64(ptr) {
        return glbu64[ptr >>> 3];
    }

    function iwrite_u64(ptr, index, value) {
        glbu64[(ptr >>> 3) + index] = value;
    }

    function iread_u64(ptr, index) {
        return glbu64[(ptr >>> 3) + index];
    }


    const ALLOWED_TYPES =
        (
            'i8-u8-i16-u16-i32-u32-f16-f32-f64-au8-ai8-au16-ai16-au32-ai32-unorm8-unorm16-str8'
             + (has_bigint64 ? "-i64-u64" : "")
        )
            .split('-');


    class cs_field_descr_t {
        constructor(name, type) {

            if(!~ALLOWED_TYPES.indexOf(type)) {
                options.ERROR_HANDLER(`Type ${type} is not a valid type!`);
            }

            this.name = name;
            this.true_type = type;

            this.atomic = false;
            if(type.charAt(0) == 'a') {
                type = type.substr(1);
                this.atomic = true;
            }

            this.type = type;

        }

        get_size() {
            switch(this.type) {
                case 'i8':
                case 'u8':
                    return 1;
                case 'i32':
                case 'u32':
                case 'f32':
                    return 4;
                case 'i16':
                case 'u16':
                    return 2;
                case 'f64':
                case 'i64':
                case 'u64':
                    return 8;
                case 'unorm8':
                    return 1;
                case 'f16':
                case 'unorm16':
                    return 2;
                case 'str8':
                    return 4;

            }
        }



    }

    cs_field_descr_t.prototype.create_getter = (function() {
        const _atomic_load = has_sab ? Atomics.load : null;

        return function _create_getter(offset) {
            if(!this.atomic) {
                switch (this.type) {
                    case 'i8':
                        return function () {
                            return glbi8[this.ptr + offset];
                        };
                    case 'u8':
                        return function () {
                            return glbu8[this.ptr + offset];
                        };
                    case 'i16':
                        return function () {
                            return glbi16[(this.ptr + offset) >>> 1];
                        };
                    case 'u16':
                        return function () {
                            return glbu16[(this.ptr + offset) >>> 1];
                        };
                    case 'i32':
                        return function () {
                            return glbi32[(this.ptr + offset) >>> 2];
                        };
                    case 'u32':
                        return function () {
                            return glbu32[(this.ptr + offset) >>> 2];
                        };
                    case 'f32':
                        return function () {
                            return glbf32[(this.ptr + offset) >>> 2];
                        };
                    case 'f64':
                        return function () {
                            return glbf64[(this.ptr + offset) >>> 3];
                        };
                    case 'u64':
                        return function () {
                            return glbu64[(this.ptr + offset) >>> 3];
                        };
                    case 'i64':
                        return function () {
                            return glbu64[(this.ptr + offset) >>> 3];
                        };
                    case 'unorm8':
                        return function () {
                            return glbu8[(this.ptr + offset)] * 0.00392156862745098;
                        };
                    case 'unorm16':
                        return function() {
                            return glbu16[(this.ptr + offset) >>> 1] * 0.000015259021896696422;
                        };
                    case 'f16':
                        return function() {
                            return decode_fp16(glbu16[(this.ptr + offset) >>> 1]);
                        };
                    case 'str8':
                        return function () {
                            const p = glbu32[(this.ptr + offset) >>> 2];
                            if(!p) {
                                return "";
                            }
                            else {
                                return read_string(p);
                            }
                        };

                }
            }
            else {
                switch (this.type) {
                    case 'i8':
                        return function () {
                            return _atomic_load(glbi8, this.ptr + offset);
                        };
                    case 'u8':
                        return function () {
                            return _atomic_load(glbu8, this.ptr + offset);
                        };
                    case 'i16':
                        return function () {
                            return _atomic_load(glbi16, (this.ptr + offset) >>> 1);
                        };
                    case 'u16':
                        return function () {
                            return _atomic_load(glbu16, (this.ptr + offset) >>> 1);
                        };
                    case 'i32':
                        return function () {
                            return _atomic_load(glbi32, (this.ptr + offset) >>> 2);
                        };
                    case 'u32':
                        return function () {
                            return _atomic_load(glbu32, (this.ptr + offset) >>> 2);
                        };

                }
            }
        };
    })();

    cs_field_descr_t.prototype.create_setter = (function() {
        const _atomic_store = has_sab ? Atomics.store : null;
        return function(offset) {
            if(!this.atomic) {
                switch (this.type) {
                    case 'i8':
                        return function (v) {
                            glbi8[this.ptr + offset] = v;
                        };
                    case 'u8':
                        return function (v) {
                            glbu8[this.ptr + offset] = v;
                        };
                    case 'i16':
                        return function (v) {
                            glbi16[(this.ptr + offset) >>> 1] = v;
                        };
                    case 'u16':
                        return function (v) {
                            glbu16[(this.ptr + offset) >>> 1] = v;
                        };
                    case 'i32':
                        return function (v) {
                            glbi32[(this.ptr + offset) >>> 2] = v;
                        };
                    case 'u32':
                        return function (v) {
                            glbu32[(this.ptr + offset) >>> 2] = v;
                        };
                    case 'f32':
                        return function (v) {
                            glbf32[(this.ptr + offset) >>> 2] = v;
                        };
                    case 'f64':
                        return function (v) {
                            glbf64[(this.ptr + offset) >>> 3] = v;
                        };
                    case 'u64':
                        return function (v) {
                            glbu64[(this.ptr + offset) >>> 3] = v;
                        };
                    case 'i64':
                        return function (v) {
                            glbi64[(this.ptr + offset) >>> 3] = v;
                        };

                    case 'unorm8':
                        return function (v) {
                            glbu8[this.ptr + offset] = (v * 255.0) >>> 0;
                        };
                    case 'unorm16':
                        return function (v) {
                            glbu16[(this.ptr + offset)  >> 1] = (v * 65535.0) >>> 0;
                        };
                    case 'f16':
                        return function(v) {
                           glbu16[(this.ptr + offset) >>> 1] = fp16_convert(v);
                        };
                    case 'str8':
                        return function (v) {
                            v = "" + v;
                            const idx = (this.ptr + offset) >>> 2;

                            const p = glbu32[idx];
                            if(p) {
                                deallocate(p);
                            }

                            const sptr = allocate(v.length+1);

                            store_string(sptr, v);

                            glbu32[idx] = sptr;

                        };
                }
            }
            else {
                switch (this.type) {
                    case 'i8':
                    return function (v) {
                        _atomic_store(glbi8, this.ptr + offset, v)
                    };
                    case 'u8':
                        return function (v) {
                            _atomic_store(glbu8, this.ptr + offset, v)
                        };
                    case 'i16':
                        return function (v) {
                            _atomic_store(glbi16, (this.ptr + offset) >>> 1, v)
                        };
                    case 'u16':
                        return function (v) {
                            _atomic_store(glbu16, (this.ptr + offset) >>> 1, v)
                        };
                    case 'i32':
                        return function (v) {
                            _atomic_store(glbi32, (this.ptr + offset) >>> 2, v)
                        };
                    case 'u32':
                        return function (v) {
                            _atomic_store(glbu32, (this.ptr + offset) >>> 2, v)
                        };
                }
            }
        };
    })();
    if(has_sab) {
        cs_field_descr_t.prototype.create_cmpxchg = (function () {
            const _atomic_cmpxchg = has_sab ? Atomics.compareExchange : null;
            return function (offset) {
                switch (this.type) {
                    case 'i8':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbi8, this.ptr + offset, expected, v)
                        };
                    case 'u8':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbu8, this.ptr + offset, expected, v)
                        };
                    case 'i16':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbi16, (this.ptr + offset) >>> 1, expected, v)
                        };
                    case 'u16':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbu16, (this.ptr + offset) >>> 1, expected, v)
                        };
                    case 'i32':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbi32, (this.ptr + offset) >>> 2, expected, v)
                        };
                    case 'u32':
                        return function (expected, v) {
                            return _atomic_cmpxchg(glbu32, (this.ptr + offset) >>> 2, expected, v)
                        };

                }
            };
        })();

        function create_atomic_op(op) {
            const _atomic_ = op;
            return function (offset) {
                switch (this.type) {
                    case 'i8':
                        return function ( v) {
                            return _atomic_(glbi8, this.ptr + offset, v);
                        };
                    case 'u8':
                        return function ( v) {
                            return _atomic_(glbu8, this.ptr + offset, v);
                        };
                    case 'i16':
                        return function (v) {
                            return _atomic_(glbi16, (this.ptr + offset) >>> 1, v);
                        };
                    case 'u16':
                        return function ( v) {
                            return _atomic_(glbu16, (this.ptr + offset) >>> 1, v);
                        };
                    case 'i32':
                        return function (v) {
                            return _atomic_(glbi32, (this.ptr + offset) >>> 2, v);
                        };
                    case 'u32':
                        return function ( v) {
                            return _atomic_(glbu32, (this.ptr + offset) >>> 2, v);
                        };

                }
            };
        }
        cs_field_descr_t.prototype.create_atomic_or = create_atomic_op(Atomics.or);
        cs_field_descr_t.prototype.create_atomic_xor = create_atomic_op(Atomics.xor);
        cs_field_descr_t.prototype.create_atomic_and = create_atomic_op(Atomics.and);

        cs_field_descr_t.prototype.create_atomic_add = create_atomic_op(Atomics.add);
        cs_field_descr_t.prototype.create_atomic_sub = create_atomic_op(Atomics.sub);

        cs_field_descr_t.prototype.create_atomic_exchange = create_atomic_op(Atomics.exchange);

        cs_field_descr_t.prototype.create_wait = (function () {
            const futex_wait = Atomics.wait;
            return function (offset) {
                if (this.true_type !== "ai32") {
                    options.ERROR_HANDLER("Only atomic i32 may use futex_wait");
                }

                return function (expected, timeout = undefined) {

                    //returns 0 if "ok" aka we waited, 1 if "not-equal" (no wait needed), and -1 if timed-out
                    return (__clz32(futex_wait(glbi32, (this.ptr + offset) >>> 2, expected, timeout).charCodeAt(0) - 110) - 30) | 0;
                };
            }
        })();

        cs_field_descr_t.prototype.create_wake = (function () {
            const futex_wake = Atomics.notify;
            return function (offset) {
                if (this.true_type !== "ai32") {
                    options.ERROR_HANDLER("Only atomic i32 may use futex_wait");
                }

                return function (expected, count = undefined) {
                    return futex_wake(glbi32, (this.ptr + offset) >>> 2, count);
                };
            }
        })();
    }

    function __create_native_class(is_stack, ..._descrs) {

        const descrs =[];
        {
            const extent_descrs = _descrs.length / 2;

            if (_descrs.length & 1) {
                options.ERROR_HANDLER("Odd number of descriptors passed to create_native_class. Expected 2-element tuples of name:type.");
            }

            for (let i = 0; i < extent_descrs; ++i) {
                const iscaled = i << 1;

                descrs.push(new cs_field_descr_t(_descrs[iscaled], _descrs[iscaled + 1]));
            }
        }



        const native_class =
            is_stack
                ?
                (function _native_class_stack() {
                    this.ptr = nullptr;
                    this.base = nullptr;
                })
                :
                (function _native_class_heap() {
                    this.ptr = nullptr;
                });

        let offset = 0;


        for(let descr of descrs) {


            const sz = descr.get_size();
            /*
                alignment check. make sure that an arraybuffer view can read the datatype correctly at the offset

                this inserts the necessary padding bytes to keep the fields aligned
            */
            if(offset & (sz - 1)) {
                offset += sz;
                //realign to closest multiple of sz
                offset &= ~(sz - 1);
            }

            Object.defineProperty(native_class.prototype, descr.name, {
                get: descr.create_getter(offset),
                set : descr.create_setter(offset)
            });

            if(descr.true_type === 'ai32') {
                native_class.prototype[descr.name + "_wake"] = descr.create_wake(offset);
                if(!is_worker) {
                    /*
                        waiting on an atomic futex isnt allowed on the main thread by the spec
                     */
                    native_class.prototype[descr.name + "_wait"] = descr.create_wait(offset);

                }
            }

            if(descr.atomic) {
                native_class.prototype[descr.name + "_cmpxchg"] = descr.create_cmpxchg(offset);
                native_class.prototype[descr.name + "_atomic_exchange"] = descr.create_atomic_exchange(offset);
                native_class.prototype[descr.name + "_atomic_and"] = descr.create_atomic_and(offset);
                native_class.prototype[descr.name + "_atomic_xor"] = descr.create_atomic_xor(offset);
                native_class.prototype[descr.name + "_atomic_or"] = descr.create_atomic_or(offset);
                native_class.prototype[descr.name + "_atomic_sub"] = descr.create_atomic_sub(offset);
                native_class.prototype[descr.name + "_atomic_add"] = descr.create_atomic_add(offset);
            }

            offset += descr.get_size();
        }


        native_class.prototype.sizeof = offset;


        if(!is_stack) {
            native_class.prototype.allocate = function () {
                this.ptr = allocate(this.sizeof);
            };

            native_class.prototype.deallocate = function () {
                if (this.ptr) {
                    deallocate(this.ptr);
                    this.ptr = nullptr;
                }
            };
        }
        else {
            native_class.prototype.allocate = function () {
                const {sp, old_base} = stack_frame_begin(this.sizeof);

                this.ptr = sp;
                this.base = old_base;

            };

            native_class.prototype.deallocate = function () {
                if (this.ptr) {
                    stack_frame_end(this.base);
                    this.base = nullptr;
                    this.ptr = nullptr;
                }
            };
        }

        return native_class;
    }

    function create_native_stack_class(...descrs) {
        const result = __create_native_class(true, ...descrs);
        return result;
    }

    function create_native_class(...descrs) {
        return __create_native_class(false, ...descrs);
    }

    function base_arraybuffer() {
        return GLOBAL_MEMORY.buffer;
    }
	/*
		constructed with a ptr and a bitfield size. nelements is currently unused
	*/
    const create_bitfield_array = (function() {

        const __constructors = (function() {
            const _imul = Math.imul;
            

            function create_one(bits_per__) {
                const bits_per = bits_per__ >>> 0;

                class packed_data_array_t {
                    constructor(nelements, ptr) {
						this.ptr = ptr;
                    }

                    store(index, value) {
                        const { ptr } = this;
                        let packed_idx = _imul(index, bits_per);
                        let index_u32 = packed_idx >>> 5;
                        let index_end = (packed_idx + bits_per) >>> 5;

                        let v = iread_u32(ptr, index_u32);
                        let mask = (1 << (bits_per )) - 1;

                        let idxmod32 = packed_idx & 0x1f;

                        if(index_end == index_u32) {

                            v &= ~(mask << idxmod32);
                            v |= (value << idxmod32);
                        }
                        else{
                            let v2 = iread_u32(ptr,index_u32+1);
                            let rest = ((packed_idx + (bits_per)) & 0x1F);
                            mask >>>= rest;

                            v &= ~(mask << idxmod32);
                            v2 &= ~((1 << (rest))-1);
                            v2 |= (value >>> (bits_per - rest));

                            v |= ((value& mask) << idxmod32);
                            iwrite_u32(ptr, index_u32+1, v2);
                        }
                        iwrite_u32(ptr, index_u32, v);
                    }

                    load(index) {
                        const { ptr } = this;

                        let packed_idx = _imul(index, bits_per);

                        let value = 0;

                        let index_u32 = packed_idx >>> 5;
                        let index_end = (packed_idx + bits_per) >>> 5;
                        let idxmod32 = packed_idx & 0x1f;
                        let v = iread_u32(ptr, index_u32);


                        if(index_u32 != index_end) {


                            let v2 = iread_u32(ptr, index_u32+1);
                            let rest = ((packed_idx + (bits_per)) & 0x1F);
                            v >>>= idxmod32;
                            v &= ((1 << bits_per) - 1) >>> (rest) ;

                            v2 &= (1 << (rest))-1;

                            v |= v2 << (bits_per - rest);
                            return v;
                        }
                        else {
                            let mask = (1 << bits_per) - 1;
                            v >>>= idxmod32;
                            v &= mask;
                            return v >>> 0;
                        }
                    }
                }
                return packed_data_array_t;
            }

            const ctor_array = [];

            for(let i = 0; i < 32; ++i) {
                ctor_array.push(create_one(i));
            }
            return ctor_array;
        })();


        return function(ptr, nelements, bits_per) {
            const __ctor = __constructors[bits_per];
            return new __ctor(nelements, ptr);
        };

    })();

	

    return _freeze({
        stack_frame_end,
        stack_frame_begin,
        allocate,
        deallocate,
        memcopy,
        memset,
        zeromem,
        store_string,
        read_string,
        write_u32,
        write_i32,
        write_f32,
        write_u16,
        write_i16,
        write_i8,
        write_u8,
        read_f32,
        read_i8,
        read_i16,
        read_i32,
        read_u16,
        read_u8,
        read_u32,
        
        iread_f32,
        iread_u32,
        iread_i32,
        iread_u16,
        iread_i16,
        iread_u8,
        iread_i8,
        iwrite_f32,
        iwrite_u32,
        iwrite_i32,
        iwrite_u16,
        iwrite_i16,
        iwrite_u8,
        iwrite_i8,

        read_f64,
        write_f64,
        iread_f64,
        iwrite_f64,

        read_u64,
        write_u64,
        iread_u64,
        iwrite_u64,

        read_i64,
        write_i64,
        iread_i64,
        iwrite_i64,

        create_native_class,
        create_native_stack_class,
        build_lookaside_list,
        destroy_lookaside_list,
        base_arraybuffer,
        FUTEX_WAITED,
        FUTEX_WASNE,
        FUTEX_TIMED_OUT,
		create_bitfield_array
    });
}
